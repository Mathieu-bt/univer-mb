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

import type { IAccessor, IOperation } from '@univerjs/core';
import { CommandType } from '@univerjs/core';
import { ISidebarService } from '@univerjs/ui';

export const ChatPanelComponentName = 'ChatPanel';

export const ToggleChatPanelOperation: IOperation = {
    id: 'chat-client.operation.toggle-chat-panel',
    type: CommandType.OPERATION,
    handler: (accessor: IAccessor) => {
        const sidebarService = accessor.get(ISidebarService);

        // For MVP, simply open it. If we want toggle logic, we need to track state.
        // We can check if the current sidebar child label is ours.
        const currentOptions = sidebarService.options;
        const isCurrent = currentOptions?.children?.label === ChatPanelComponentName;

        if (isCurrent && currentOptions.visible) {
            sidebarService.close();
        } else {
            sidebarService.open({
                header: { title: 'AI Assistant' },
                children: { label: ChatPanelComponentName },
                width: 350,
            });
        }
        return true;
    },
};
