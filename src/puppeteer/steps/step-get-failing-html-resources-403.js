/*
 * Copyright 2022 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-disable-next-line import/prefer-default-export */
function getFailingHtmlResources() {
  return (action) => async (actionParams) => {
    const params = actionParams;

    try {
      params.logger.info('do get failing html resources');

      await params.page.setRequestInterception(true);

      params.page
        .on('requestfinished', (request) => {
          if (request.response().status() === 403 && request.resourceType() !== 'image') {
            params.result = ({
              ...params.result,
              warning: `403 on ${request.url()} - Section(s) might not have been extracted, re-run the CLI on this URL with --no-headless flag`,
            });
          }
        });

      // main action
      await action(params);
    } catch (e) {
      params.logger.error('get failing html resources catch', e);
      params.result = {
        passed: false,
        error: e,
      };
    } finally {
      params.logger.info('get failing html resources finally');
    }

    return params;
  };
}

exports.getFailingHtmlResources = getFailingHtmlResources;
