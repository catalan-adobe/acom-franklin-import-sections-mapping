#!/usr/bin/env node

// imports
const path = require('path');
const fs = require('fs');
const { terminal } = require('terminal-kit');
const { cliWorkerHandler } = require('../src/cliWorkerHandler');

/*
 * constants
 */

const MILO_BLOCK_SAMPLE_PAGE_ROOT = 'https://main--milo--adobecom.hlx.page/docs/library/blocks/';
const MILO_LIBRARY_JSON_URL = 'https://milo.adobe.com/docs/library/library.json';
const MILO_BLOCKS_DEFAULT = ['accordion', 'aside', 'carousel', 'fragment', 'iconblock', 'marquee', 'media', 'text', 'z-pattern'];
const CUSTOM_BLOCKS_DEFAULT = ['unknown', 'to-remove'];
const MILO_BLOCK_SAMPLE_PAGE_HTML = `<html>
  <body>
  <h3><a href="https://milo.adobe.com" target="_blank">Milo</a> Blocks Sample Pages</h3>
  <ul>%BLOCKS%</ul>
  </body>
</html>`;

/*
 * Helper functions
 */

async function getBlocksList() {
  let blocksList = [];

  try {
    // try getting blocks from milo library
    const resp = await fetch(MILO_LIBRARY_JSON_URL);
    const library = await resp.json();
    blocksList = library.blocks.data.map((block) => ({
      name: block.path.substring(block.path.lastIndexOf('/') + 1),
      path: block.path,
    }));
  } catch (e) {
    // fallback to default blocks
    blocksList = MILO_BLOCKS_DEFAULT.map((block) => (
      {
        name: block,
        path: MILO_BLOCK_SAMPLE_PAGE_ROOT + block,
      }
    ));
  }

  // add custom blocks
  blocksList = blocksList.concat(CUSTOM_BLOCKS_DEFAULT.map((block) => ({ name: block, path: '' })));

  return blocksList;
}

function yargsBuilder(yargs) {
  return yargs
    .option('interactive', {
      alias: 'i',
      describe: 'Start the application in interactive mode, you will be prompted to copy/paste the list of URLs directly in the terminal. Enter an empty line to finish the process',
      type: 'boolean',
    })
    .option('file', {
      alias: 'f',
      describe: 'Path to a text file containing the list of URLs to deliver (urls pattern: "https://<branch>--<repo>--<owner>.hlx.page/<path>")',
      type: 'string',
    })
    .conflicts('f', 'i')
    .option('css-exclusions', {
      alias: 'e',
      describe: 'A list of CSS selectors to exclude from the analysis (comma separated)',
      type: 'string',
      default: 'header, footer, .globalnavheader, .globalnavfooter',
    })
    .option('output-folder', {
      alias: 'o',
      describe: 'The target folder for the generated data',
      type: 'string',
      default: 'sections-mapping',
    })
    .option('workers', {
      alias: 'w',
      describe: 'Number of workers to use (max. 8)',
      type: 'number',
      default: 1,
      coerce: (value) => {
        if (value > 8) {
          terminal.yellow('Warning: Maximum number of workers is 8. Using 8 workers instead.\n');
          return 8;
        }
        return value;
      },
    })
    .option('no-headless', {
      describe: 'Starts the browser in non-headless mode. Useful for debugging. Also, it forces workers to 1.',
      type: 'boolean',
    })
    .option('analyse-sections', {
      describe: 'Analyse the content of the section to try to identify the type of content (text, image, video, etc.)',
      type: 'boolean',
    });
}

/*
 * Main
 */

exports.desc = 'Generate sections data for given list of URLs (json + screenshots)';
exports.builder = yargsBuilder;
exports.handler = async (argv) => {
  // create output folder structure
  const outputFolder = path.isAbsolute(argv.outputFolder)
    ? argv.outputFolder
    : path.join(process.cwd(), argv.outputFolder);

  // headless true unless --no-headless is passed
  const headless = argv.headless !== undefined ? argv.headless : true;

  // analyse-sections false unless --analyse-sections is passed
  const analyseSections = argv.analyseSections !== undefined ? argv.analyseSections : false;

  const blocksList = await getBlocksList();

  // create milo blocks samples html page
  const blockSampleListItems = [];

  for (let i = 0; i < blocksList.length; i += 1) {
    const block = blocksList[i];
    const blockFolder = path.join(outputFolder, 'blocks', block.name);
    if (!fs.existsSync(blockFolder)) {
      fs.mkdirSync(blockFolder, { recursive: true });
    }
    if (block.path !== '') {
      blockSampleListItems.push(`<li><a href="${block.path}">${block.name}</a></li>`);
    }
  }

  fs.writeFileSync(path.join(outputFolder, 'blocks', 'milo_blocks_samples_pages.html'), MILO_BLOCK_SAMPLE_PAGE_HTML.replace('%BLOCKS%', blockSampleListItems.join('\n')));

  // execute preparation of the sections mapping
  return cliWorkerHandler('prepare_sections_data_worker.js', {
    outputFolder,
    headless,
    analyseSections,
  }, argv);
};
