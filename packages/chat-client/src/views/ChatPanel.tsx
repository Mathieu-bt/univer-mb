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

import type { IChatMessage } from '../services/chat.service';
import { Button, clsx } from '@univerjs/design';
import { useDependency } from '@univerjs/ui';
import React, { useEffect, useRef, useState } from 'react';
import { ChatService } from '../services/chat.service';

export const ChatPanel = () => {
    const chatService = useDependency(ChatService);
    const [messages, setMessages] = useState<IChatMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [sheetMode, setSheetMode] = useState(false);
    const [activeCell, setActiveCell] = useState<{ cellA1: string; rangeA1: string; display: string }>({
        cellA1: '',
        rangeA1: '',
        display: '',
    });
    const [cellDraft, setCellDraft] = useState('');
    const [isEditingCell, setIsEditingCell] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
    const [thinkingLevel, setThinkingLevel] = useState<'minimal' | 'low' | 'medium' | 'high'>('high');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const sub = chatService.messages$.subscribe(setMessages);
        return () => sub.unsubscribe();
    }, [chatService]);

    useEffect(() => {
        const sub = chatService.activeCell$.subscribe((state) => {
            setActiveCell(state);
            if (!isEditingCell) {
                setCellDraft(state.display);
            }
        });
        return () => sub.unsubscribe();
    }, [chatService, isEditingCell]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    const handleSetApiKey = () => {
        if (apiKey.trim()) {
            chatService.setApiKey(apiKey.trim());
        }
    };

    const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const model = e.target.value;
        setSelectedModel(model);
        chatService.setModel(model);
    };

    const handleThinkingLevelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const level = e.target.value as 'minimal' | 'low' | 'medium' | 'high';
        setThinkingLevel(level);
        chatService.setThinkingLevel(level);
    };

    const handleSend = async () => {
        if (!inputValue.trim() || isLoading) return;
        setIsLoading(true);
        const message = inputValue;
        setInputValue('');
        try {
            await chatService.sendMessage(message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const commitCellDraft = () => {
        chatService.setActiveCellDisplay(cellDraft);
        setIsEditingCell(false);
    };

    const cancelCellDraft = () => {
        setCellDraft(activeCell.display);
        setIsEditingCell(false);
    };

    useEffect(() => {
        if (!sheetMode) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented) return;

            const isShortcut = e.ctrlKey || e.metaKey;

            if (isShortcut && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                chatService.copySelection();
                return;
            }

            if (isShortcut && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                chatService.cutSelection();
                return;
            }

            if (isShortcut && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                chatService.pasteClipboard();
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                commitCellDraft();
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                cancelCellDraft();
                return;
            }

            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                if (isEditingCell && cellDraft !== activeCell.display) {
                    commitCellDraft();
                }

                if (e.key === 'ArrowUp') chatService.moveActiveCell(-1, 0);
                if (e.key === 'ArrowDown') chatService.moveActiveCell(1, 0);
                if (e.key === 'ArrowLeft') chatService.moveActiveCell(0, -1);
                if (e.key === 'ArrowRight') chatService.moveActiveCell(0, 1);
                return;
            }

            if (e.key === 'Backspace') {
                e.preventDefault();
                setIsEditingCell(true);
                setCellDraft((prev) => prev.slice(0, -1));
                return;
            }

            if (e.key === 'Delete') {
                e.preventDefault();
                setIsEditingCell(true);
                setCellDraft('');
                return;
            }

            if (!isShortcut && !e.altKey && e.key.length === 1) {
                e.preventDefault();
                setIsEditingCell(true);
                setCellDraft((prev) => prev + e.key);
            }
        };

        window.addEventListener('keydown', onKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', onKeyDown, { capture: true } as any);
    }, [activeCell.display, cellDraft, chatService, isEditingCell, sheetMode]);

    const handleClearHistory = () => {
        chatService.clearHistory();
    };

    const lastRecap = (() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'model') return msg.recap || msg.content;
        }
        return '';
    })();

    const renderMessage = (msg: IChatMessage, index: number) => {
        const isModel = msg.role === 'model';

        return (
            <div
                key={index}
                className={clsx('univer-flex univer-flex-col', msg.role === 'user'
                    ? 'univer-items-end'
                    : 'univer-items-start')}
            >
                <div
                    className={clsx(
                        'univer-max-w-[90%] univer-rounded-lg univer-p-3 univer-text-sm univer-shadow-sm',
                        msg.role === 'user'
                            ? 'univer-bg-blue-600 univer-text-white'
                            : `
                              univer-bg-gray-100
                              dark:univer-bg-gray-800 dark:univer-text-gray-200
                            `
                    )}
                >
                    {isModel
                        ? (
                            <div className="univer-space-y-2">
                                <div className="univer-whitespace-pre-wrap">{msg.recap || msg.content}</div>
                                {msg.code && (
                                    <details>
                                        <summary
                                            className={`
                                              univer-cursor-pointer univer-text-[10px] univer-font-bold univer-uppercase
                                              univer-text-gray-500
                                              hover:univer-text-blue-500
                                            `}
                                        >
                                            Show generated code
                                        </summary>
                                        <pre
                                            className={`
                                              univer-my-2 univer-overflow-x-auto univer-rounded-md univer-border
                                              univer-border-gray-700 univer-bg-gray-900 univer-p-3 univer-text-xs
                                              univer-text-blue-300
                                            `}
                                        >
                                            <code>{msg.code}</code>
                                        </pre>
                                    </details>
                                )}
                            </div>
                        )
                        : msg.content}
                </div>
                {isModel && msg.trace && msg.trace.length > 0 && (
                    <details className="univer-mt-1 univer-w-full">
                        <summary
                            className={`
                              univer-ml-1 univer-cursor-pointer univer-text-[10px] univer-text-gray-500
                              hover:univer-text-blue-500
                            `}
                        >
                            View Execution Trace (
                            {msg.trace.length}
                            {' '}
                            logs)
                        </summary>
                        <div
                            className={`
                              univer-mt-1 univer-max-h-40 univer-overflow-y-auto univer-rounded univer-border
                              univer-bg-gray-50 univer-p-2 univer-font-mono univer-text-[10px]
                              dark:univer-border-gray-800 dark:univer-bg-gray-950
                            `}
                        >
                            {msg.trace.map((log, i) => (
                                <div
                                    key={i}
                                    className={clsx('univer-mb-1', log.includes('❌') || log.includes('Error')
                                        ? 'univer-text-red-500'
                                        : log.includes('✅')
                                            ? 'univer-text-green-500'
                                            : 'univer-text-gray-500')}
                                >
                                    {log}
                                </div>
                            ))}
                        </div>
                    </details>
                )}
            </div>
        );
    };

    // Model responses are rendered as recap + optional code toggle (see renderMessage).

    return (
        <div
            className={`
              univer-flex univer-h-full univer-flex-col univer-bg-white univer-font-sans
              dark:univer-bg-gray-900
            `}
        >
            <div
                className={`
                  univer-flex univer-items-center univer-justify-between univer-border-b univer-bg-gray-50 univer-p-3
                  dark:univer-border-gray-700 dark:univer-bg-gray-800
                `}
            >
                <span
                    className={`
                      univer-text-sm univer-font-bold univer-text-gray-700
                      dark:univer-text-gray-200
                    `}
                >
                    AI Assistant
                </span>
                <div className="univer-flex univer-items-center univer-gap-2">
                    <button
                        onClick={() => setSheetMode((v) => !v)}
                        className={clsx(
                            `
                              univer-rounded univer-border univer-px-2 univer-py-1 univer-text-[10px] univer-font-bold
                              univer-uppercase univer-transition-colors
                              dark:univer-border-gray-700
                            `,
                            sheetMode
                                ? 'univer-border-blue-600 univer-bg-blue-600 univer-text-white'
                                : `
                                  univer-border-gray-200 univer-bg-white univer-text-gray-600
                                  dark:univer-bg-gray-900 dark:univer-text-gray-300
                                `
                        )}
                        title="Sheet mode: arrows / Ctrl+C/X/V / typing apply to the sheet"
                    >
                        Sheet mode
                    </button>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={`
                          univer-rounded univer-p-1 univer-transition-colors
                          hover:univer-bg-gray-200
                          dark:hover:univer-bg-gray-700
                        `}
                        title="Settings"
                    >
                        ⚙️
                    </button>
                </div>
            </div>

            <div
                className={`
                  univer-space-y-2 univer-border-b univer-bg-gray-50 univer-p-3
                  dark:univer-border-gray-700 dark:univer-bg-gray-800
                `}
            >
                <div className="univer-flex univer-items-center univer-gap-2">
                    <div
                        className={`
                          univer-min-w-14 univer-rounded univer-border univer-bg-white univer-px-2 univer-py-1
                          univer-font-mono univer-text-[10px] univer-text-gray-700
                          dark:univer-border-gray-700 dark:univer-bg-gray-900 dark:univer-text-gray-200
                        `}
                        title={activeCell.rangeA1 ? `Selection: ${activeCell.rangeA1}` : ''}
                    >
                        {activeCell.cellA1 || '—'}
                    </div>
                    <input
                        value={cellDraft}
                        onChange={(e) => {
                            setIsEditingCell(true);
                            setCellDraft(e.target.value);
                        }}
                        onFocus={() => setIsEditingCell(true)}
                        onBlur={() => setIsEditingCell(false)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitCellDraft();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelCellDraft();
                            }
                        }}
                        placeholder="Type value or =FORMULA for active cell"
                        className={`
                          univer-flex-1 univer-rounded univer-border univer-bg-white univer-px-3 univer-py-2
                          univer-text-xs univer-outline-none
                          focus:univer-ring-2 focus:univer-ring-blue-500
                          dark:univer-border-gray-700 dark:univer-bg-gray-900 dark:univer-text-white
                        `}
                    />
                    <Button size="small" onClick={commitCellDraft}>Apply</Button>
                </div>

                {!!lastRecap && (
                    <div
                        className={`
                          univer-rounded univer-border univer-bg-white univer-p-2 univer-text-[11px]
                          univer-text-gray-600
                          dark:univer-border-gray-700 dark:univer-bg-gray-900 dark:univer-text-gray-300
                        `}
                    >
                        <div
                            className={`
                              univer-mb-1 univer-text-[10px] univer-font-bold univer-uppercase univer-text-gray-500
                            `}
                        >
                            Last changes
                        </div>
                        <div className="univer-line-clamp-3 univer-whitespace-pre-wrap">{lastRecap}</div>
                    </div>
                )}

                {sheetMode && (
                    <div className="univer-text-[10px] univer-text-gray-500">
                        Sheet mode is ON: arrows / typing / Ctrl+C/X/V apply to the sheet. Press Esc to cancel edits, Enter to apply.
                    </div>
                )}
            </div>

            {showSettings && (
                <div
                    className={`
                      univer-space-y-4 univer-border-b univer-bg-gray-50 univer-p-4 univer-shadow-inner
                      dark:univer-border-gray-700 dark:univer-bg-gray-800
                    `}
                >
                    <div>
                        <label
                            className={`
                              univer-mb-1 univer-block univer-text-[10px] univer-font-bold univer-uppercase
                              univer-text-gray-500
                            `}
                        >
                            Gemini API Key
                        </label>
                        <div className="univer-flex univer-gap-2">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                onBlur={handleSetApiKey}
                                placeholder="sk-..."
                                className={`
                                  univer-flex-1 univer-rounded univer-border univer-p-1.5 univer-text-xs
                                  dark:univer-border-gray-700 dark:univer-bg-gray-900 dark:univer-text-white
                                `}
                            />
                        </div>
                    </div>
                    <div className="univer-flex univer-gap-4">
                        <div className="univer-flex-1">
                            <label
                                className={`
                                  univer-mb-1 univer-block univer-text-[10px] univer-font-bold univer-uppercase
                                  univer-text-gray-500
                                `}
                            >
                                Model
                            </label>
                            <select
                                value={selectedModel}
                                onChange={handleModelChange}
                                className={`
                                  univer-w-full univer-rounded univer-border univer-p-1.5 univer-text-xs
                                  dark:univer-border-gray-700 dark:univer-bg-gray-900 dark:univer-text-white
                                `}
                            >
                                <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                                <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
                                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                            </select>
                        </div>
                        <div className="univer-flex-1">
                            <label
                                className={`
                                  univer-mb-1 univer-block univer-text-[10px] univer-font-bold univer-uppercase
                                  univer-text-gray-500
                                `}
                            >
                                Thinking
                            </label>
                            <select
                                value={thinkingLevel}
                                onChange={handleThinkingLevelChange}
                                className={`
                                  univer-w-full univer-rounded univer-border univer-p-1.5 univer-text-xs
                                  dark:univer-border-gray-700 dark:univer-bg-gray-900 dark:univer-text-white
                                `}
                            >
                                <option value="minimal">Minimal</option>
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High (Best)</option>
                            </select>
                        </div>
                    </div>
                    <div className="univer-flex univer-justify-end">
                        <Button size="small" onClick={() => setShowSettings(false)}>Close</Button>
                    </div>
                </div>
            )}

            <div className="univer-flex-1 univer-space-y-6 univer-overflow-y-auto univer-p-4">
                {messages.length === 0 && (
                    <div
                        className={`
                          univer-flex univer-h-full univer-flex-col univer-items-center univer-justify-center
                          univer-opacity-50
                        `}
                    >
                        <span className="univer-mb-2 univer-text-4xl">📊</span>
                        <p className="univer-text-sm univer-font-medium">Univer AI Assistant</p>
                        <p className="univer-text-xs">I can help you build sheets with code.</p>
                        <div className="univer-mt-4 univer-w-full univer-space-y-2">
                            <div
                                className={`
                                  univer-rounded univer-bg-gray-100 univer-p-2 univer-text-[11px] univer-italic
                                  dark:univer-bg-gray-800
                                `}
                            >
                                "Create a financial statement for Google"
                            </div>
                            <div
                                className={`
                                  univer-rounded univer-bg-gray-100 univer-p-2 univer-text-[11px] univer-italic
                                  dark:univer-bg-gray-800
                                `}
                            >
                                "Format the first row as headers"
                            </div>
                        </div>
                    </div>
                )}
                {messages.map((msg, index) => renderMessage(msg, index))}
                {isLoading && (
                    <div className="univer-flex univer-flex-col univer-items-start">
                        <div
                            className={`
                              univer-animate-pulse univer-rounded-lg univer-bg-gray-100 univer-p-3 univer-text-sm
                              dark:univer-bg-gray-800 dark:univer-text-gray-400
                            `}
                        >
                            Thinking meticulously...
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div
                className={`
                  univer-border-t univer-p-4
                  dark:univer-border-gray-700
                `}
            >
                <div className="univer-mb-3 univer-flex univer-gap-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={sheetMode ? 'Sheet mode is ON (toggle to chat)' : 'Type a request...'}
                        disabled={isLoading || sheetMode}
                        className={`
                          univer-flex-1 univer-rounded-full univer-border univer-px-3 univer-py-2 univer-text-sm
                          univer-outline-none
                          focus:univer-ring-2 focus:univer-ring-blue-500
                          disabled:univer-opacity-50
                          dark:univer-border-gray-700 dark:univer-bg-gray-900 dark:univer-text-white
                        `}
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading || sheetMode || !inputValue.trim()}
                        className={`
                          univer-flex univer-h-9 univer-w-9 univer-items-center univer-justify-center
                          univer-rounded-full univer-bg-blue-600 univer-p-2 univer-text-white univer-transition-colors
                          hover:univer-bg-blue-700
                          disabled:univer-opacity-50
                        `}
                    >
                        {isLoading ? '⏳' : '➔'}
                    </button>
                </div>
                <div className="univer-flex univer-justify-center">
                    <button
                        onClick={handleClearHistory}
                        className={`
                          univer-text-[10px] univer-font-bold univer-uppercase univer-text-gray-400
                          univer-transition-colors
                          hover:univer-text-red-500
                        `}
                    >
                        Clear Chat History
                    </button>
                </div>
            </div>
        </div>
    );
};
