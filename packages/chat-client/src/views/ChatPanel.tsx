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

    const handleClearHistory = () => {
        chatService.clearHistory();
    };

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
                    {isModel ? renderContent(msg.content) : msg.content}
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

    const renderContent = (content: string) => {
        const parts = content.split(/(```[\s\S]*?```)/g);
        return parts.map((part, i) => {
            if (part.startsWith('```')) {
                const code = part.replace(/```(?:javascript|js)?\n?/, '').replace(/```$/, '');
                return (
                    <pre
                        key={i}
                        className={`
                          univer-my-3 univer-overflow-x-auto univer-rounded-md univer-border univer-border-gray-700
                          univer-bg-gray-900 univer-p-3 univer-text-xs univer-text-blue-300
                        `}
                    >
                        <code>{code}</code>
                    </pre>
                );
            }
            return <span key={i} className="univer-whitespace-pre-wrap">{part}</span>;
        });
    };

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
                        placeholder="Type a request..."
                        disabled={isLoading}
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
                        disabled={isLoading || !inputValue.trim()}
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
