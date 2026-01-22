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

const SHEET_CONTEXT_MAX_SAMPLE_ROWS = 10;
const SHEET_CONTEXT_MAX_SAMPLE_COLS = 8;
const SHEET_CONTEXT_MAX_CHARS = 2400;
const SHEET_CONTEXT_CACHE_TTL_MS = 1500;
const MAX_AUTO_FIX_ATTEMPTS = 2;

function columnIndexToA1(columnIndex: number): string {
    let n = columnIndex + 1;
    let s = '';
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function toA1(rowIndex: number, columnIndex: number): string {
    return `${columnIndexToA1(columnIndex)}${rowIndex + 1}`;
}

function a1ToRowCol(a1: string): { row: number; col: number } | undefined {
    const m = /^([A-Z]+)(\d+)$/.exec(a1.trim().toUpperCase());
    if (!m) return;
    const [, colLetters, rowStr] = m;
    const row = Number(rowStr) - 1;
    if (!Number.isFinite(row) || row < 0) return;
    let col = 0;
    for (const ch of colLetters) {
        col = col * 26 + (ch.charCodeAt(0) - 64);
    }
    col -= 1;
    if (col < 0) return;
    return { row, col };
}

export interface IChatMessage {
    role: 'user' | 'model';
    content: string;
    trace?: string[];
}

export interface ITraceLog {
    type: 'info' | 'error' | 'code';
    message: string;
}

interface IGeminiContent {
    role: string;
    parts: { text: string }[];
}

const SYSTEM_INSTRUCTION = `You are an AI assistant that helps users modify spreadsheets using the Univer API.
When the user asks you to modify the spreadsheet, you MUST respond with JavaScript code that uses the univerAPI object.
The code should be wrapped in a code block with the language 'javascript'.

Available API:
- univerAPI.getActiveWorkbook() - Get the active workbook
- workbook.getActiveSheet() - Get the active sheet
- sheet.getRange(row, col, numRows, numCols) OR sheet.getRange('A1:B10') - Get a range
- sheet.getDataRange() - Range that covers the used data region
- range.setValue(value) - Set a single value
- range.setValues([[values]]) - Set multiple values
- range.getValues() - Get values from a range
- range.clear({ contentsOnly?: boolean, formatOnly?: boolean }) - Clear range
- range.setFontWeight('bold' | 'normal') - Set font weight
- range.setBackground(color) - Set background color (e.g. '#ff0000')
- range.setFontColor(color) - Set font color (e.g. '#000000')
- sheet.getRowCount(), sheet.getColumnCount() - Current grid size
- sheet.getMaxRows(), sheet.getMaxColumns() - Max grid size

PERFORMANCE RULES:
- Do NOT build huge 2D arrays to clear a sheet. Use sheet.getDataRange().clear({ contentsOnly: true }) instead.
- Prefer A1 notation for small edits (e.g. sheet.getRange('A2').setValue('hi')).
- Only call range.getValues() for the specific range you need (avoid full-sheet reads).

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
    private _conversationHistory: IGeminiContent[] = [];

    private _sheetContextDirty = true;
    private _sheetContextCache: { key: string; text: string; updatedAt: number } | undefined;

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

    private _invalidateSheetContextCache(): void {
        this._sheetContextDirty = true;
    }

    /**
     * Get current sheet context for LLM awareness
     * Uses safe injector access to avoid circular dependencies
     */
    private _getSheetContext(force = false): string {
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

            const workbookId = typeof (workbook as any).getUnitId === 'function' ? String((workbook as any).getUnitId()) : 'unknown-workbook';
            const sheetId = typeof (worksheet as any).getSheetId === 'function' ? String((worksheet as any).getSheetId()) : 'unknown-sheet';
            const cacheKey = `${workbookId}:${sheetId}`;

            const now = Date.now();
            if (
                !force
                && !this._sheetContextDirty
                && this._sheetContextCache
                && this._sheetContextCache.key === cacheKey
                && now - this._sheetContextCache.updatedAt < SHEET_CONTEXT_CACHE_TTL_MS
            ) {
                return this._sheetContextCache.text;
            }

            const sheetName = worksheet.getName();
            const cellMatrix = worksheet.getCellMatrix();
            const rangeProvider = worksheet as unknown as {
                getDataRealRange?: () => { startRow: number; endRow: number; startColumn: number; endColumn: number };
                getRowCount: () => number;
                getColumnCount: () => number;
            };

            const realRange = rangeProvider.getDataRealRange?.();
            const isEmpty = !realRange || (realRange.endRow < realRange.startRow) || (realRange.endColumn < realRange.startColumn);
            if (isEmpty) {
                const firstCell = cellMatrix.getValue(0, 0);
                if (!firstCell || firstCell.v === undefined || firstCell.v === null || firstCell.v === '') {
                    const text = `[Sheet: ${sheetName}] - Empty sheet`;
                    this._sheetContextCache = { key: cacheKey, text, updatedAt: now };
                    this._sheetContextDirty = false;
                    return text;
                }
            }

            const usedStartRow = realRange ? realRange.startRow : 0;
            const usedStartCol = realRange ? realRange.startColumn : 0;
            const usedEndRow = realRange ? realRange.endRow : Math.max(0, rangeProvider.getRowCount() - 1);
            const usedEndCol = realRange ? realRange.endColumn : Math.max(0, rangeProvider.getColumnCount() - 1);

            const sampleEndRow = Math.min(usedEndRow, usedStartRow + SHEET_CONTEXT_MAX_SAMPLE_ROWS - 1);
            const sampleEndCol = Math.min(usedEndCol, usedStartCol + SHEET_CONTEXT_MAX_SAMPLE_COLS - 1);

            let text = `[Sheet: ${sheetName}]\n`;
            text += `Used range: ${toA1(usedStartRow, usedStartCol)}:${toA1(usedEndRow, usedEndCol)}\n\n`;

            text += '| Row |';
            for (let c = usedStartCol; c <= sampleEndCol; c++) {
                text += ` ${columnIndexToA1(c)} |`;
            }
            text += '\n|-----|';
            for (let c = usedStartCol; c <= sampleEndCol; c++) {
                text += '------|';
            }
            text += '\n';

            for (let r = usedStartRow; r <= sampleEndRow; r++) {
                text += `| ${r + 1} |`;
                for (let c = usedStartCol; c <= sampleEndCol; c++) {
                    const cell = cellMatrix.getValue(r, c);
                    let value = '';
                    if (cell && cell.v !== undefined && cell.v !== null) {
                        value = String(cell.v).replaceAll('\n', ' ').substring(0, 30);
                        if (String(cell.v).length > 30) value += '...';
                    }
                    text += ` ${value} |`;
                }
                text += '\n';
                if (text.length > SHEET_CONTEXT_MAX_CHARS) {
                    text += '\n... (context truncated)';
                    break;
                }
            }

            if (usedEndRow > sampleEndRow) {
                text += `\n... (${usedEndRow - sampleEndRow} more rows not shown)`;
            }
            if (usedEndCol > sampleEndCol) {
                text += `\n... (${usedEndCol - sampleEndCol} more columns not shown)`;
            }

            this._sheetContextCache = { key: cacheKey, text, updatedAt: now };
            this._sheetContextDirty = false;
            return text;
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
                await this._executeWithAutoFix(codeMatch[1].trim(), text);
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
        return this._callGeminiAPIWithContents(this._conversationHistory, this._thinkingLevel);
    }

    private async _callGeminiAPIWithContents(
        contents: IGeminiContent[],
        thinkingLevel: 'minimal' | 'low' | 'medium' | 'high'
    ): Promise<{ text: string; thoughts?: string }> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent?key=${this._apiKey}`;

        const body: Record<string, any> = {
            system_instruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }],
            },
            contents,
            generationConfig: {},
        };

        // Add thinking level for Gemini 3
        if (this._model.startsWith('gemini-3')) {
            body.generationConfig.thinkingConfig = {
                thinkingLevel,
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

    private _syncLastModelMessageTrace(): void {
        const currentMessages = this._messages$.getValue();
        if (currentMessages.length === 0) return;
        const lastMsg = currentMessages[currentMessages.length - 1];
        if (lastMsg.role !== 'model') return;
        lastMsg.trace = this._trace$.getValue().map((t) => t.message);
        this._messages$.next([...currentMessages]);
    }

    private _extractLikelyA1Refs(text: string): string[] {
        const matches = text.toUpperCase().match(/\b[A-Z]{1,3}\d{1,7}\b/g) ?? [];
        const unique = Array.from(new Set(matches));
        return unique.slice(0, 5);
    }

    private _readCellValueByA1(a1: string): string {
        try {
            const loc = a1ToRowCol(a1);
            if (!loc) return '[invalid A1]';
            const univerInstanceService = this._injector.get(IUniverInstanceService);
            const workbook = univerInstanceService.getCurrentUnitOfType<Workbook>(UniverInstanceType.UNIVER_SHEET);
            if (!workbook) return '[no workbook]';
            const worksheet = workbook.getActiveSheet();
            if (!worksheet) return '[no worksheet]';

            const cell = worksheet.getCellMatrix().getValue(loc.row, loc.col);
            if (!cell || cell.v === undefined || cell.v === null) return '';
            return String(cell.v);
        } catch {
            return '[read failed]';
        }
    }

    private async _executeCode(code: string): Promise<{ ok: boolean; error?: string }> {
        this._addTrace('code', code);
        this._addTrace('info', 'Executing code via UniscriptExecutionService...');

        try {
            const executionService = this._injector.get(IUniscriptExecutionService);
            if (!executionService) {
                throw new Error('IUniscriptExecutionService not found. Is Uniscript plugin registered?');
            }

            const success = await executionService.execute(code);
            if (success) {
                return { ok: true };
            }

            let errorMsg = 'Code execution returned false.';
            if (typeof executionService.getLastError === 'function') {
                const lastError = executionService.getLastError();
                if (lastError) {
                    errorMsg += `\nError: ${lastError.message}`;
                }
            }
            return { ok: false, error: errorMsg };
        } catch (error) {
            return { ok: false, error: `Execution error: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }

    private async _executeWithAutoFix(initialCode: string, userRequest: string): Promise<void> {
        let code = initialCode;

        try {
            for (let attempt = 0; attempt <= MAX_AUTO_FIX_ATTEMPTS; attempt++) {
                const result = await this._executeCode(code);
                if (result.ok) {
                    this._addTrace('info', '✅ Code executed successfully.');

                    this._invalidateSheetContextCache();
                    const postContext = this._getSheetContext(true);
                    this._addTrace('info', `Post-execution sheet context:\n${postContext}`);

                    const refs = this._extractLikelyA1Refs(userRequest);
                    for (const ref of refs) {
                        this._addTrace('info', `Verify ${ref}: ${this._readCellValueByA1(ref)}`);
                    }
                    return;
                }

                this._addTrace('error', `❌ ${result.error ?? 'Unknown execution error'}`);
                if (attempt >= MAX_AUTO_FIX_ATTEMPTS) {
                    return;
                }

                this._invalidateSheetContextCache();
                const currentContext = this._getSheetContext(true);
                this._addTrace('info', `Auto-fix attempt ${attempt + 1}/${MAX_AUTO_FIX_ATTEMPTS}...`);

                const fixPrompt = [
                    'You previously generated JavaScript code for Univer and it failed.',
                    'Fix the code. Return ONLY one ```javascript``` code block. No extra text.',
                    '',
                    '[USER REQUEST]',
                    userRequest,
                    '',
                    '[CURRENT SHEET DATA]',
                    currentContext,
                    '',
                    '[FAILED CODE]',
                    '```javascript',
                    code,
                    '```',
                    '',
                    '[ERROR]',
                    result.error ?? 'Unknown error',
                    '',
                    'Constraints:',
                    '- Prefer fast operations (e.g. sheet.getDataRange().clear({ contentsOnly: true }) for clearing).',
                    '- Do not allocate huge 2D arrays for full-sheet operations.',
                ].join('\n');

                const { text: fixResponse } = await this._callGeminiAPIWithContents(
                    [{ role: 'user', parts: [{ text: fixPrompt }] }],
                    'minimal'
                );

                const fixedCodeMatch = fixResponse.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
                if (!fixedCodeMatch) {
                    this._addTrace('error', '❌ Auto-fix failed: model did not return a javascript code block.');
                    return;
                }

                code = fixedCodeMatch[1].trim();
                this._addTrace('info', 'Received fixed code from Gemini, retrying execution...');
            }
        } finally {
            this._syncLastModelMessageTrace();
        }
    }

    private async _executeCodeFromResponse(code: string): Promise<void> {
        await this._executeWithAutoFix(code, '');
    }

    clearHistory(): void {
        this._conversationHistory = [];
        this._messages$.next([]);
        this._trace$.next([]);
    }
}
