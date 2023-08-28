const crypto = require('crypto');
const assert = require('assert');

async function analyseSection(section, params) {

  const pageWidth = params.page.viewport().width;

  // get all sectionEls
  const sectionEls = await section.div.$$('*');
  // console.log(sectionEls);

  const discoveredEls = [];

  // loop over all sectionEls to find full-width sections
  for (let i = 0; i < sectionEls.length; i += 1) {
    const sectionEl = sectionEls[i];
    const discoveredEl = {
      element: sectionEl,
    };

    const boundingBox = await sectionEl.boundingBox();

    const bbb = await sectionEl.evaluate(
      (el) => el.getBoundingClientRect(),
    );

    console.log('bbb: ', bbb);
    console.log('boundingBox: ', boundingBox);

    // is the sectionEl a full-width section?
    if (boundingBox) {
      discoveredEl.x = Math.floor(boundingBox.x);
      discoveredEl.y = Math.floor(boundingBox.y);
      discoveredEl.width = Math.floor(boundingBox.width);
      discoveredEl.height = Math.floor(boundingBox.height);

      /* eslint-disable-next-line no-await-in-loop */
      const xpath = await params.page.evaluate(
        (node) => window.getXPath(node, false),
        sectionEl,
      );
      discoveredEl.xpath = xpath;

      const xpathHash = crypto.createHash('sha1').update(xpath).digest('hex');
      discoveredEl.xpathHash = xpathHash;

      // console.log('====================================================');
      // console.log('discoveredEl: ', discoveredEl);
      // // console.log(discoveredEls);
      // // console.log('  ---');
      // // console.log(discoveredEl);
      // console.log('====================================================');
      // console.log('found: ')
      // console.log(discoveredEls.find((el) => { 
      //   try {
      //     console.log(el);
      //     console.log(discoveredEl);
      //     assert.deepEqual(el, discoveredEl); 
      //     return true;
      //   } catch(e) {
      //     console.log(e);
      //     return false;
      //   }
      // }))
      // console.log('====================================================');

      if (
        boundingBox.y >= 0
        && boundingBox.height > 50
        // && boundingBox.height < 0.8 * pageHeight
        && boundingBox.width * boundingBox.height > 250 * 250 // 380 * 260 // ~ card size
        && boundingBox.width * boundingBox.height < 1000 * 1000 // arbitrary big number
        && !discoveredEls.find((el) => { 
          return (el.x === discoveredEl.x && el.y === discoveredEl.y && el.width === discoveredEl.width && el.height === discoveredEl.height);
          })
      ) {
        discoveredEls.push(discoveredEl);
      }/* else {
        section.block = {
          type: 'to-remove',
          comment: '[acom-section-mapping prepare] invisible section, force removing it in importer script to avoid ghost content to be added to the docx',
        };
        sections.push(section);
      }*/
    }
  }

  const rows = [];

  discoveredEls.forEach((el) => {
    const currentEl = rows[rows.length - 1];

    // if (currentEl) {
    //   console.log('currentEl: ', currentEl.y, currentEl.height);
    //   console.log('    el: ', el.y, el.height);
    // }

    if (
      rows.length === 0 
      || (
        currentEl.y !== el.y
        // && el.y >= currentEl.y
        && (el.y + 3) >= (currentEl.y + currentEl.height)
      )
    ) {
      rows.push(el);
    }
  });

  return discoveredEls;
}

// exports
exports.analyseSection = analyseSection;
