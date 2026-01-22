/**
 * Copyright 2023-present DreamNum Co., Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Workbook } from '@univerjs/core';
import { Disposable, ILogService, Inject, Injector, IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import { IUniscriptExecutionService } from '@univerjs/uniscript';
import { BehaviorSubject } from 'rxjs';

declare const __GOOGLE_API_KEY__: string | undefined;

export interface IChatMessage {
    role: 'user' | 'model';
    content: string;
    trace?: string[];
}

export interface ITraceLog {
    type: 'info' | 'error' | 'code';
    message: string;
}

interface GeminiContent {
    role: string;
    parts: { text: string }[];
}

const SYSTEM_INSTRUCTION = `You are an AI assistant that helps users modify spreadsheets using the Univer API.
When the user asks you to modify the spreadsheet, you MUST respond with JavaScript code that uses the univerAPI object.
The code should be wrapped in a code block with the language 'javascript'.

Available API:
- univerAPI.getActiveWorkbook() - Get the active workbook
- workbook.getActiveSheet() - Get the active sheet
- sheet.getRange(row, col, numRows, numCols) - Get a range (0-indexed)
- range.setValue(value) - Set a single value
- range.setValues([[values]]) - Set multiple values
- range.getValues() - Get values from a range
- range.setFontWeight('bold' | 'normal') - Set font weight
- range.setBackground(color) - Set background color (e.g. '#ff0000')
- range.setFontColor(color) - Set font color (e.g. '#000000')
- sheet.getRowCount(), sheet.getMaxColumns() - Get dimensions

Example response for "Create a table with headers Name and Age":
\`\`\`javascript
const sheet = univerAPI.getActiveWorkbook().getActiveSheet();
sheet.getRange(0, 0, 1, 1).setValue('Name');
sheet.getRange(0, 1, 1, 1).setValue('Age');
sheet.getRange(0, 0, 1, 2).setFontWeight('bold');
\`\`\`

IMPORTANT: 
- Row and column indices are 0-indexed.
- Use \`sheet.getRowCount()\` to check bounds if unsure.
- \`range.setBackground(color)\` and \`range.setFontColor(color)\` take hex strings.
- \`getMaxRows\` is NOT reliable for bounds checking; use \`getRowCount\`.
Always explain what you're doing before the code block.`;

export class ChatService extends Disposable {
    private readonly _messages$ = new BehaviorSubject<IChatMessage[]>([]);
    readonly messages$ = this._messages$.asObservable();

    private readonly _trace$ = new BehaviorSubject<ITraceLog[]>([]);
    readonly trace$ = this._trace$.asObservable();

    private _apiKey: string = '';
    private _model: string = 'gemini-3-flash-preview';
    private _thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' = 'high';
    private _conversationHistory: GeminiContent[] = [];

    constructor(
        @ILogService private readonly _logService: ILogService,
        @Inject(Injector) private readonly _injector: Injector
    ) {
        super();

        // Optional build-time injection (recommended for local dev): set GOOGLE_API_KEY and the demo bundler
        // will expose it as `__GOOGLE_API_KEY__` so you don't need to paste it in the UI each refresh.
        if (!this._apiKey && typeof __GOOGLE_API_KEY__ !== 'undefined' && __GOOGLE_API_KEY__) {
            this._apiKey = __GOOGLE_API_KEY__;
            this._logService.log('[ChatService]', 'API key loaded from environment');
        }

        this.disposeWithMe(() => {
            this._messages$.complete();
            this._trace$.complete();
        });
    }

    get messages(): IChatMessage[] {
        return this._messages$.getValue();
    }

    setApiKey(key: string): void {
        this._apiKey = key;
        this._logService.log('[ChatService]', 'API key set');
    }

    setModel(model: string): void {
        this._model = model;
        this._logService.log('[ChatService]', 'Model set to:', model);
    }

    setThinkingLevel(level: 'minimal' | 'low' | 'medium' | 'high'): void {
        this._thinkingLevel = level;
    }

    private _addTrace(type: ITraceLog['type'], message: string): void {
        const currentTrace = this._trace$.getValue();
        this._trace$.next([...currentTrace, { type, message }]);
        this._logService.log('[ChatService Trace]', `[${type}]`, message);
    }

    /**
     * Get current sheet context for LLM awareness
     * Uses safe injector access to avoid circular dependencies
     */
    private _getSheetContext(): string {
        try {
            const univerInstanceService = this._injector.get(IUniverInstanceService);
            const workbook = univerInstanceService.getCurrentUnitOfType<Workbook>(UniverInstanceType.UNIVER_SHEET);
            if (!workbook) {
                return '[No active workbook]';
            }

            const worksheet = workbook.getActiveSheet();
            if (!worksheet) {
                return '[No active worksheet]';
            }

            const sheetName = worksheet.getName();
            const cellMatrix = worksheet.getCellMatrix();
            const maxRows = Math.min(worksheet.getRowCount(), 20); // Limit to 20 rows
            const maxCols = Math.min(worksheet.getColumnCount(), 10); // Limit to 10 cols

            // Find actual used range
            let lastRow = 0;
            let lastCol = 0;
            for (let r = 0; r < maxRows; r++) {
                for (let c = 0; c < maxCols; c++) {
                    const cell = cellMatrix.getValue(r, c);
                    if (cell && (cell.v !== undefined && cell.v !== null && cell.v !== '')) {
                        lastRow = Math.max(lastRow, r);
                        lastCol = Math.max(lastCol, c);
                    }
                }
            }

            if (lastRow === 0 && lastCol === 0) {
                const firstCell = cellMatrix.getValue(0, 0);
                if (!firstCell || firstCell.v === undefined || firstCell.v === null || firstCell.v === '') {
                    return `[Sheet: ${sheetName}] - Empty sheet`;
                }
            }

            // Build markdown table
            const colLetters = 'ABCDEFGHIJ'.split('');
            let table = `[Sheet: ${sheetName}]\n`;
            table += `Used range: A1:${colLetters[lastCol]}${lastRow + 1}\n\n`;

            // Header row
            table += '| Row |';
            for (let c = 0; c <= lastCol; c++) {
                table += ` ${colLetters[c]} |`;
            }
            table += '\n|-----|';
            for (let c = 0; c <= lastCol; c++) {
                table += '------|';
            }
            table += '\n';

            // Data rows
            for (let r = 0; r <= Math.min(lastRow, 15); r++) { // Cap at 15 rows for context
                table += `| ${r + 1} |`;
                for (let c = 0; c <= lastCol; c++) {
                    const cell = cellMatrix.getValue(r, c);
                    let value = '';
                    if (cell && cell.v !== undefined && cell.v !== null) {
                        value = String(cell.v).substring(0, 20); // Truncate long values
                        if (String(cell.v).length > 20) value += '...';
                    }
                    table += ` ${value} |`;
                }
                table += '\n';
            }

            if (lastRow > 15) {
                table += `\n... (${lastRow - 15} more rows not shown)`;
            }

            return table;
        } catch (error) {
            this._logService.error('[ChatService]', 'Error getting sheet context:', error);
            return '[Error reading sheet data]';
        }
    }

    async sendMessage(text: string): Promise<string> {
        this._logService.log('[ChatService]', 'Sending message:', text);
        this._trace$.next([]); // Clear trace for new message

        // Add user message to UI
        const currentMessages = this.messages;
        this._messages$.next([...currentMessages, { role: 'user', content: text }]);

        if (!this._apiKey) {
            const errorMsg = 'Please set your Gemini API key first.';
            this._messages$.next([...this._messages$.getValue(), { role: 'model', content: errorMsg }]);
            return errorMsg;
        }

        try {
            // Get sheet context
            const sheetContext = this._getSheetContext();
            this._addTrace('info', `Sheet context extracted:\n${sheetContext}`);
            this._addTrace('info', `Calling Gemini API (${this._model}, level: ${this._thinkingLevel})...`);

            // Prepend sheet context to the user message
            const enrichedMessage = `[CURRENT SHEET DATA]\n${sheetContext}\n\n[USER REQUEST]\n${text}`;

            // Add to conversation history
            this._conversationHistory.push({
                role: 'user',
                parts: [{ text: enrichedMessage }],
            });

            // Call Gemini API
            const { text: response, thoughts } = await this._callGeminiAPI();

            if (thoughts) {
                this._addTrace('info', `Model thoughts: ${thoughts.substring(0, 500)}...`);
            }
            this._addTrace('info', 'Received response from Gemini.');

            // Add model response to history (store original response, not with context)
            this._conversationHistory.push({
                role: 'model',
                parts: [{ text: response }],
            });

            // Extract code
            const codeMatch = response.match(/```(?:javascript|js)?\n([\s\S]*?)```/);

            this._messages$.next([
                ...this._messages$.getValue(),
                {
                    role: 'model',
                    content: response,
                    trace: this._trace$.getValue().map((t) => t.message),
                },
            ]);

            // Execute code if present
            if (codeMatch) {
                await this._executeCodeFromResponse(codeMatch[1].trim());
            } else {
                this._addTrace('info', 'No code block found to execute.');
            }

            return response;
        } catch (error) {
            const errorMsg = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            this._addTrace('error', errorMsg);
            this._messages$.next([...this._messages$.getValue(), { role: 'model', content: errorMsg }]);
            return errorMsg;
        }
    }

    private async _callGeminiAPI(): Promise<{ text: string; thoughts?: string }> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent?key=${this._apiKey}`;

        const body: any = {
            system_instruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }],
            },
            contents: this._conversationHistory,
            generationConfig: {},
        };

        // Add thinking level for Gemini 3
        if (this._model.startsWith('gemini-3')) {
            body.generationConfig.thinkingConfig = {
                thinkingLevel: this._thinkingLevel,
            };
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        let text = '';
        let thoughts = '';

        for (const part of parts) {
            if (part.text) {
                text += part.text;
            }
            if (part.thought) {
                thoughts += part.thought;
            }
        }

        return { text: text || 'No response generated', thoughts };
    }

    private async _executeCodeFromResponse(code: string): Promise<void> {
        this._addTrace('code', code);
        this._addTrace('info', 'Executing code via UniscriptExecutionService...');

        try {
            const executionService = this._injector.get(IUniscriptExecutionService);
            if (!executionService) {
                throw new Error('IUniscriptExecutionService not found. Is Uniscript plugin registered?');
            }

            const success = await executionService.execute(code);
            if (success) {
                this._addTrace('info', '✅ Code executed successfully.');
            } else {
                let errorMsg = '❌ Code execution returned false.';
                if (typeof executionService.getLastError === 'function') {
                    const lastError = executionService.getLastError();
                    if (lastError) {
                        errorMsg += `\nError: ${lastError.message}`;
                    }
                }
                this._addTrace('error', errorMsg);
            }
        } catch (error) {
            const errorMsg = `Execution error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            this._addTrace('error', errorMsg);
        }

        // Update the last message with final trace
        const currentMessages = this._messages$.getValue();
        if (currentMessages.length > 0) {
            const lastMsg = currentMessages[currentMessages.length - 1];
            if (lastMsg.role === 'model') {
                lastMsg.trace = this._trace$.getValue().map((t) => t.message);
                this._messages$.next([...currentMessages]);
            }
        }
    }

    clearHistory(): void {
        this._conversationHistory = [];
        this._messages$.next([]);
        this._trace$.next([]);
    }
}
