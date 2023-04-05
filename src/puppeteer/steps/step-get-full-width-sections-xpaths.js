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
const crypto = require('crypto');
const fs = require('fs');
const pUtils = require('path');
const sharp = require('sharp');
const { Buffer } = require('node:buffer');
const { writeFileSync } = require('fs');

async function generateAndSavePageScreenshotWithSectionsBoxes(sections, page, filename) {
  const { Time } = await import('franklin-bulk-shared');

  const screenshot = await page.screenshot({
    encoding: 'binary',
    fullPage: true,
    type: 'jpeg',
    quality: 10,
  });

  await Time.sleep(1000);

  const boxes = [];
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    if (!section.block) {
      const svgBuffer = `<svg width="${section.width}" height="${section.height}">
          <rect width="${section.width - 8}" height="${section.height - 8}" x="4" y="4" fill="none" stroke="#00F" stroke-width="2"/>
        </svg>`;
      boxes.push({
        input: Buffer.from(svgBuffer),
        left: section.x,
        top: section.y,
      });
    }
  }

  return sharp(screenshot)
    .composite(boxes)
    .png()
    .toFile(filename);
}

const pptrPageScript = `
window.getXPath = function(elm, addClass = false) {
  var allNodes = document.getElementsByTagName('*');
  for (var segs = []; elm && elm.nodeType == 1; elm = elm.parentNode) {
    /*if (elm.hasAttribute('id')) {
        var uniqueIdCount = 0;
        for (var n=0;n < allNodes.length;n++) {
            if (allNodes[n].hasAttribute('id') && allNodes[n].id == elm.id) uniqueIdCount++;
            if (uniqueIdCount > 1) break;
        };
        if ( uniqueIdCount == 1) {
            segs.unshift('id("' + elm.getAttribute('id') + '")');
            return segs.join('/');
        } else {
            segs.unshift(elm.localName.toLowerCase() + '[@id="' + elm.getAttribute('id') + '"]');
        }
    } else if (elm.hasAttribute('class')) {
        segs.unshift(elm.localName.toLowerCase() + '[@class="' + [...elm.classList].join(" ").trim() + '"]');
    } else {*/
    if (addClass && elm.hasAttribute('class')) {
      segs.unshift(elm.localName.toLowerCase() + '[@class="' + [...elm.classList].join(" ").trim() + '"]');
    } else {

        for (i = 1, sib = elm.previousSibling; sib; sib = sib.previousSibling) {
            if (sib.localName == elm.localName)  i++;
        }
        segs.unshift(elm.localName.toLowerCase() + '[' + i + ']');
    }
  }
  return segs.length ? '/' + segs.join('/') : null;
};
window.parentHasCSSSelector = function(elm, selector) {
  return elm.closest(selector) !== null;
};
window.getNSiblingsElements = function(n, cssExclusions = []) {
  let selectedXpathPattern = '';
  const xpathGrouping = [];

  document.body.querySelectorAll(':scope > div div').forEach(d => {
    if(!cssExclusions.some(s => [...d.parentElement.querySelectorAll(s)].some(e => e === d))) {
      const xpath = window.getXPath(d);
      const xp = xpath.substring(0, xpath.lastIndexOf('['));
      if (!xpathGrouping[xp]) {
        xpathGrouping[xp] = [d];
      } else {
        xpathGrouping[xp].push(d);
      }
    }
  });

  // find the xpath pattern that has n elements
  const reversedXPaths = Object.keys(xpathGrouping);//.reverse();
  for (var i = 0; i < reversedXPaths.length; i++) {
    const key = reversedXPaths[i];
    if (xpathGrouping[key].length >= n) {
      selectedXpathPattern = key;
      break;
    }
  }

  return selectedXpathPattern;
}
`;

/* eslint-disable-next-line import/prefer-default-export */
function getFullWidthSectionsXPaths({ outputFolder = `${process.cwd()}/xpaths`, exclusions = '' }) {
  return (action) => async (actionParams) => {
    const franklin = await import('franklin-bulk-shared');
    const params = actionParams;

    try {
      params.logger.info('do get full-width sections xpaths');

      // main action
      await action(params);

      /*
       * init
       */

      const cssExclusions = exclusions.split(',').map((x) => x.trim());

      // prepare output folder
      const [p, filename] = franklin.Url.buildPathAndFilenameWithPathFromUrl(params.url, 'sections-screenshot', 'png');
      const path = pUtils.join(outputFolder, p);
      if (!fs.existsSync(path)) {
        fs.mkdirSync(path, { recursive: true });
      }

      // inject javascript function to generate xpath
      await params.page.addScriptTag({
        content: pptrPageScript,
      });

      // get all divs
      const xpPattern = await params.page.evaluate((excl) => window.getNSiblingsElements(3, excl), cssExclusions);
      const divs = await params.page.$x(xpPattern);

      // Evaluate JavaScript
      const pageHeight = await params.page.evaluate(() => window.document.body.scrollHeight);

      await params.page.setViewport({
        width: 1280,
        height: pageHeight,
        deviceScaleFactor: 1,
      });

      /*
       * Look for "sections"
       */

      const sections = [];
      const urlHash = crypto.createHash('sha1').update(params.url).digest('hex');

      // loop over all divs to find full-width sections
      for (let i = 0; i < divs.length; i += 1) {
        const div = divs[i];

        /* eslint-disable-next-line no-await-in-loop */
        const checkCSSExclusions = await Promise.all(cssExclusions.map(async (e) => {
          /* eslint-disable-next-line no-await-in-loop */
          const b = await params.page.evaluate(
            (node, css) => window.parentHasCSSSelector(node, css),
            div,
            e,
          );
          const res = b === true;
          return res;
        }));

        const isCSSExcluded = checkCSSExclusions.some((x) => x === true);

        if (!isCSSExcluded) {
          /* eslint-disable-next-line no-await-in-loop */
          const boundingBox = await div.boundingBox();

          const section = {
            url: params.url,
            urlHash,
            div,
            // xpathWithClasses,
            xpath: '',
            xpathHash: '',
          };

          // is the div a full-width section?
          if (boundingBox) {
            section.x = Math.floor(boundingBox.x);
            section.y = Math.floor(boundingBox.y);
            section.width = Math.floor(boundingBox.width);
            section.height = Math.floor(boundingBox.height);

            /* eslint-disable-next-line no-await-in-loop */
            const xpath = await params.page.evaluate(
              (node) => window.getXPath(node, false),
              div,
            );
            section.xpath = xpath;

            const xpathHash = crypto.createHash('sha1').update(xpath).digest('hex');
            section.xpathHash = xpathHash;

            if (
              boundingBox.y >= 0
              && boundingBox.height > 50
              && boundingBox.height < 0.8 * pageHeight
            ) {
              sections.push(section);
            } else {
              section.block = {
                type: 'to-remove',
                comment: '[acom-section-mapping prepare] invisible section, force removing it in importer script to avoid ghost content to be added to the docx',
              };
              sections.push(section);
            }
          }
        }
      }

      const result = sections;
      for (let i = 0; i < result.length; i += 1) {
        const section = result[i];
        if (!section.block) {
          /* eslint-disable-next-line no-await-in-loop */
          await section.div.screenshot({
            path: pUtils.join(path, `${urlHash}.section-${i}.${section.xpathHash}.png`),
          });
          /* eslint-disable-next-line no-await-in-loop */
          await franklin.Time.sleep(100);
        }
      }

      // save sections data json file
      await writeFileSync(pUtils.join(path, `${urlHash}-sections.json`), JSON.stringify(result, null, 2));

      // save a page screenshot with all discovered sections boxes
      await generateAndSavePageScreenshotWithSectionsBoxes(result, params.page, pUtils.join(path, `${urlHash}.${filename}`));
    } catch (e) {
      params.logger.error('get full-width sections xpaths catch', e);
      params.result = {
        passed: false,
        error: e,
      };
    } finally {
      params.logger.info('get full-width sections xpaths finally');
    }

    return params;
  };
}

exports.getFullWidthSectionsXPaths = getFullWidthSectionsXPaths;
