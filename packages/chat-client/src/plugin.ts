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

import { Inject, Injector, Plugin } from '@univerjs/core';
import { ChatController } from './controllers/chat.controller';
import { ChatService } from './services/chat.service';

const PLUGIN_NAME = 'UNIVER_CHAT_CLIENT_PLUGIN';

export class UniverChatClientPlugin extends Plugin {
    static override pluginName = PLUGIN_NAME;

    constructor(
        @Inject(Injector) protected override _injector: Injector
    ) {
        super();
    }

    override onStarting(): void {
        const injector = this._injector;
        injector.add([ChatController]);
        injector.add([ChatService]);
    }

    override onSteady(): void {
        // Initialize the controller
        this._injector.get(ChatController);
    }
}
