const { Polygon } = require('@flatten-js/core');
const { isLightColor } = require('./colors');

function determineLayout(polygons) {
  const sortedPolygons = polygons.sort((a, b) => {
    if (a.box.ymin < b.box.ymin) {
      return -1;
    } if (a.box.ymin > b.box.ymin) {
      return 1;
    }
    return a.box.xmin - b.box.xmin;
  });

  console.log('sortedPolygons', sortedPolygons.map((polygon) => polygon.box));
  console.log('sortedPolygons.length', sortedPolygons.length);

  let numRows = 1;
  let numCols = 1; // sortedPolygons.length;
  let prevPolygon = sortedPolygons[0];
  let colCounter = 1;
  for (let i = 1; i < sortedPolygons.length; i += 1) {
    const polygon = sortedPolygons[i];
    console.log('====================================');
    console.log(prevPolygon.box);
    console.log('---');
    console.log(polygon.box);
    if (polygon.box.ymin >= prevPolygon.box.ymax) {
      numRows += 1;

      console.log('---');
      console.log('numRows++', numRows);

      numCols = Math.max(numCols, colCounter);
      colCounter = 1;
    }
    if (polygon.box.xmin >= prevPolygon.box.xmax) {
      colCounter += 1;

      console.log('---');
      console.log('colCounter++', colCounter);

      // if (polygon.box.ymin >= prevPolygon.box.ymax) {
      // }
      // numCols = i;
      // break;
    }
    console.log('====================================');
    prevPolygon = polygon;
  }

  return { numRows, numCols };
}

function createBoxHierarchy(blocks) {
  console.log(blocks);

  const rootPolygon = new Polygon([
    [0, 0],
    [1000000, 0],
    [1000000, 1000000],
    [0, 1000000],
  ]); // create a root polygon that contains all other polygons

  const polygons = blocks.map((block) => ({
    ...block,
    polygon: new Polygon([
      [block.x, block.y],
      [block.x + block.width, block.y],
      [block.x + block.width, block.y + block.height],
      [block.x, block.y + block.height],
    ]), // create flatten-js polygons from input blocks
  }));

  const hierarchy = {
    polygon: rootPolygon,
    x: rootPolygon.box.xmin,
    y: rootPolygon.box.ymin,
    width: rootPolygon.box.xmax - rootPolygon.box.xmin,
    height: rootPolygon.box.ymax - rootPolygon.box.ymin,
    children: [],
  };

  function buildHierarchy(parent, children, usedIndices) {
    children.forEach((child, index) => {
      const { polygon } = child;
      if (usedIndices.has(index)) {
        return;
      }
      if (parent.polygon.contains(polygon)) {
        const newParent = {
          ...child,
          // polygon: polygon,
          // x: polygon.box.xmin,
          // y: polygon.box.ymin,
          // width: polygon.box.xmax - polygon.box.xmin,
          // height: polygon.box.ymax - polygon.box.ymin,
          children: [],
        };
        parent.children.push(newParent);
        usedIndices.add(index);
        buildHierarchy(newParent, children, usedIndices);
      }
    });
  }

  buildHierarchy(hierarchy, polygons, new Set());

  return hierarchy;
}

function extractVerticalBoxes(node) {
  const verticalBoxes = [];
  if (node.children.length > 1) {
    let previousChild;
    let isVertical = true;
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i];
      if (previousChild && child.y !== previousChild.y + previousChild.height) {
        isVertical = false;
        break;
      }
      previousChild = child;
    }
    if (isVertical) {
      const vNodes = node.children.map((child) => {
        /* eslint-disable no-param-reassign */
        delete child.polygon;
        return child;
      });
      verticalBoxes.push(...vNodes);
    } else {
      for (let i = 0; i < node.children.length; i += 1) {
        const child = node.children[i];
        verticalBoxes.push(...extractVerticalBoxes(child));
      }
    }
  } else if (node.children.length === 1) {
    verticalBoxes.push(...extractVerticalBoxes(node.children[0]));
  }
  return verticalBoxes;
}

function removePolygonProperty(node) {
  /* eslint-disable no-param-reassign */
  delete node.polygon;
  node.children.forEach((child) => removePolygonProperty(child));
}

function getVerticalBoxes(blocks) {
  const hierarchy = createBoxHierarchy(blocks);
  // console.log(hierarchy);
  const verticalBoxes = extractVerticalBoxes(hierarchy);
  if (verticalBoxes.length === 0) {
    verticalBoxes.push(...hierarchy.children);
  }
  removePolygonProperty(hierarchy);
  return verticalBoxes;
}

async function predictContent(section, discoveredBlocks, verticalBoxes) {
  /*
    * analyse layout
    */

  const polygons = verticalBoxes.map((block) => new Polygon([
    [block.x, block.y],
    [block.x + block.width, block.y],
    [block.x + block.width, block.y + block.height],
    [block.x, block.y + block.height],
  ])); // create flatten-js polygons from input blocks

  // console.log('polygons:', polygons);
  const layout = determineLayout(polygons);
  console.log('layout:', layout);

  return verticalBoxes.map(async (box) => {
    const contentAnalysis = {
      hasText: null,
      hasImage: null,
      hasBackgroundColor: null,
      hasBackgroundImage: null,
      theme: 'light',
    };

    /*
     * analyse css styles
     */

    const collectedDOMData = await box.element.evaluate((element) => {
      const data = {
        text: null,
        hasText: null,
        hasImage: false,
        css: {
          color: null,
          backgroundColor: null,
          backgroundImage: null,
        },
      };

      // css analysis
      const styles = window.getComputedStyle(element);
      data.css.color = styles.color.trim().indexOf('rgba(0, 0, 0, 0)') === -1 ? styles.color : null;
      data.css.backgroundColor = styles.backgroundColor.trim().indexOf('rgba(0, 0, 0, 0)') === -1 ? styles.backgroundColor : null;
      data.css.backgroundImage = styles.backgroundImage.trim().indexOf('none') === -1 ? styles.backgroundImage : null;

      element.querySelectorAll('*').forEach((child) => {
        console.log('child:', child.nodeName);
        if (child.nodeName === 'IMG') {
          data.hasImage = true;
        }
        const childStyles = window.getComputedStyle(child);
        console.log('childStyles.backgroundColor:', childStyles.backgroundColor);
        if (childStyles.color) {
          data.css.color = childStyles.color;
        }
        if (childStyles.backgroundColor && childStyles.backgroundColor.trim().indexOf('rgba(0, 0, 0, 0)') === -1) {
          data.css.backgroundColor = childStyles.backgroundColor;
        }
        if (childStyles.backgroundImage && childStyles.backgroundImage.trim().indexOf('none') === -1) {
          data.css.backgroundImage = childStyles.backgroundImage;
        }
      });

      // text analysis
      const clone = element.cloneNode(true);
      clone.querySelectorAll('script, style').forEach((child) => child.remove());
      data.text = clone.textContent.replaceAll('\n', '').trim();
      data.hasText = data.text.length > 0;

      // return data
      return data;
    });

    contentAnalysis.hasBackgroundColor = collectedDOMData.css.backgroundColor !== null;
    contentAnalysis.hasBackgroundImage = collectedDOMData.css.backgroundImage !== null;
    contentAnalysis.theme = isLightColor(collectedDOMData.css.color) ? 'dark' : 'light';
    contentAnalysis.hasText = collectedDOMData.hasText;
    contentAnalysis.hasImage = collectedDOMData.hasImage;

    console.log('contentAnalysis ====================================');
    console.log(contentAnalysis);
    console.log('text ====================================');
    console.log(collectedDOMData.text);
    console.log('====================================');

    return contentAnalysis;
  });
}

module.exports = {
  getVerticalBoxes,
  predictContent,
};
