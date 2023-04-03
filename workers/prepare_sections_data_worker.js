const path = require('path');
const { parentPort } = require('worker_threads');
const { getFullWidthSectionsXPaths } = require('../src/puppeteer/steps/step-get-full-width-sections-xpaths');

/*
* Worker thread
*/

// Listen for messages from the parent thread
parentPort.on('message', async (msg) => {
  if (msg && msg.type === 'exit') {
    // If the parent thread sent 'exit', exit the worker thread
    process.exit();
  } else {
    const franklin = await import('franklin-bulk-shared');

    try {
      const [browser, page] = await franklin.Puppeteer.initBrowser({
        headless: msg.options.headless,
      });

      await franklin.Puppeteer.runStepsSequence(
        page,
        msg.url,
        [
          franklin.Puppeteer.Steps.postLoadWait(1000),
          franklin.Puppeteer.Steps.GDPRAutoConsent(),
          franklin.Puppeteer.Steps.execAsync(async (browserPage) => {
            await browserPage.keyboard.press('Escape');
          }),
          franklin.Puppeteer.Steps.smartScroll(),
          franklin.Puppeteer.Steps.postLoadWait(500),
          getFullWidthSectionsXPaths({
            outputFolder: path.join(msg.options.outputFolder, 'data'),
            exclusions: msg.argv.cssExclusions,
          }),
        ],
      );

      // cool down
      await franklin.Time.sleep(250);

      await browser.close();

      parentPort.postMessage({
        url: msg.url,
        passed: true,
        result: 'Success',
      });
    } catch (error) {
      parentPort.postMessage({
        url: msg.url,
        passed: false,
        result: error.message,
      });
    }
  }
});
