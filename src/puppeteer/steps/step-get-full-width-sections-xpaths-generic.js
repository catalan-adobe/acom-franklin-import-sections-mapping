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

const DEFAULT_PAGE_WIDTH = 1280;

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
    const svgBuffer = `<svg width="${section.width}" height="${section.height}">
        <rect width="${section.width - 8}" height="${section.height - 8}" x="4" y="4" fill="none" stroke="#00F" stroke-width="2"/>
      </svg>`;
    boxes.push({
      input: Buffer.from(svgBuffer),
      left: section.x,
      top: section.y,
    });
  }

  return sharp(screenshot)
    .composite(boxes)
    .png()
    .toFile(filename);
}

function isInside(s1 ,s2) {
  // console.log(s1, s2);

  const s2Area = s2.width * s2.height;
  const s2AreaInsideS1 = (s2.x + s2.width - s1.x) * (s2.y + s2.height - s1.y);

  console.log(s2Area, s2AreaInsideS1, s2AreaInsideS1 / s2Area);
  return (
    // s2AreaInsideS1 / s2Area < 0.8 &&
    s2.x >= s1.x &&
    s2.y >= s1.y - 40 &&

    // s2.x + s2.width <= s1.x + s1.width &&
    // s2.y + s2.height <= s1.y + s1.height

    // should not use dom strucutre to determine if a section is inside another...
    s2.xpath.indexOf(s1.xpath) === 0
  );
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
      console.log(p, filename);
      console.log(params.url);
      const path = pUtils.join(outputFolder, p);
      if (!fs.existsSync(path)) {
        fs.mkdirSync(path, { recursive: true });
      }

      // Evaluate JavaScript
      const pageHeight = await params.page.evaluate(() => window.document.body.scrollHeight || window.document.body.offsetHeight);

      await params.page.setViewport({
        width: DEFAULT_PAGE_WIDTH,
        height: pageHeight,
        deviceScaleFactor: 1,
      });

      // inject javascript function to generate xpath
      await params.page.addScriptTag({
        content: pptrPageScript,
      });

      /*
         * Look for "sections"
         */
      const sections = [];
      const urlHash = crypto.createHash('sha1').update(params.url).digest('hex');

      // get all divs
      const divs = await params.page.$$('div');

      // loop over all divs to find full-width sections
      for (let i = 0; i < divs.length; i += 1) {
        const div = divs[i];

        /* eslint-disable-next-line no-await-in-loop */
        const xpathWithClasses = await params.page.evaluate(
          (node) => window.getXPath(node, true),
          div,
        );

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

        /* eslint-disable-next-line no-await-in-loop */
        const boundingBox = await div.boundingBox();

        // console.log('pageHeight', pageHeight);

        // is the div a full-width section?
        if (!isCSSExcluded
          && boundingBox
          // && boundingBox.x === 0
          && boundingBox.y >= 0
          && boundingBox.width > DEFAULT_PAGE_WIDTH * 0.5
          && boundingBox.height >= 25
          && boundingBox.height < 0.6 * pageHeight
        ) {
          const section = {
            x: Math.floor(boundingBox.x),
            y: Math.floor(boundingBox.y),
            width: Math.floor(boundingBox.width),
            height: Math.floor(boundingBox.height),
            url: params.url,
            urlHash,
            div,
            xpathWithClasses,
            xpath: '',
            xpathHash: '',
          };

          /* eslint-disable-next-line no-await-in-loop */
          const xpath = await params.page.evaluate(
            (node) => window.getXPath(node, false),
            div,
          );
          section.xpath = xpath;

          const xpathHash = crypto.createHash('sha1').update(xpath).digest('hex');
          section.xpathHash = xpathHash;

          if (sections.length === 0) {
            sections.push(section);
          }

          const already = sections.some((s) => 
                    (s.x === section.x &&
                    s.y === section.y &&
                    s.width === section.width &&
                    s.height === section.height) ||
                    isInside(s, section));
          if (!already) {
            sections.push(section);
          }
        }
      }

      // let selectedXpathPattern = '';
      // const xpathGrouping = [];
      // sections.forEach((s) => {
      //   const xp = s.xpath.substring(0, s.xpath.lastIndexOf('['));
      //   if (!xpathGrouping[xp]) {
      //     xpathGrouping[xp] = 1;
      //   } else {
      //     xpathGrouping[xp] += 1;
      //     if (xpathGrouping[xp] > 3) {
      //       selectedXpathPattern = xp;
      //     }
      //   }
      // });
      // const result = sections.filter((element) => element.xpath.substring(0, element.xpath.lastIndexOf('[')) === selectedXpathPattern);

      const result = sections;

      for (let i = 0; i < result.length; i += 1) {
        const section = result[i];

        console.log(section.xpath, section.y, section.height, section.y + section.height);

        /* eslint-disable-next-line no-await-in-loop */
        await section.div.screenshot({
          path: pUtils.join(path, `${urlHash}.section-${i}.${section.xpathHash}.png`),
        });
        /* eslint-disable-next-line no-await-in-loop */
        await franklin.Time.sleep(100);
      }

      // save sections data json file
      await writeFileSync(pUtils.join(path, `${urlHash}-sections.json`), JSON.stringify(sections, null, 2));

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