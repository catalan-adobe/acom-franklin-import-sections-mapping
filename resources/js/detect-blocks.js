(function() {

  function isVerticallyAligned(el1, el2) {
    const rect1 = el1.getBoundingClientRect();
    const rect2 = el2.getBoundingClientRect();
    const tolerance = 1; // Tolerance for slight variations in alignment
    return Math.abs(rect1.top - rect2.top) <= tolerance;
  }

  function isVisible(node) {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !(/none/i.test(window.getComputedStyle(node).display.trim()));
  }

  function getLogPrefix(level) {
    return Array(level).join('  ');
  }

  function isANodeToExplore(node, options) {
    if (!isVisible(node)) {
      return false;
    }
    
    if (options.cssExclusions && options.cssExclusions.some(sel => node.classList.contains(sel))) {
      return false;
    }

    return true;
  }

  const detect = {

    traverseAndCheckAlignment: function(node, options, level) {
      if (isANodeToExplore(node, options)) {
        // const nodeRect = node.getBoundingClientRect();
        const currentLevel = level ? level + 1 : 1;
        const hierarchy = { 
          node,
          rect: node.getBoundingClientRect(),
          children: [],
        };

        // console.log(getLogPrefix(currentLevel), 'rect', JSON.stringify(node.getBoundingClientRect()));

        const childrenToExplore = Array.from(node.children).filter(child => isANodeToExplore(child, options));
        
        const a = [];
        for (const child of childrenToExplore) {
          a.push(detect.traverseAndCheckAlignment(child, options, currentLevel));
        } 
        
        if (childrenToExplore.length > 1) {
          console.log(getLogPrefix(currentLevel), `found ${node.children.length} children in`, node);
          hierarchy.children = a;
        }
        return hierarchy;
      }
    },

    run: function() {
      const h = detect.traverseAndCheckAlignment(document.body, {
        cssExclusions: [ 'modalContainer', 'globalnavheader', 'globalnavfooter' ],
      });

      console.log(h);
    },
 
  };

  // // Start the traversal from the document's body
  // traverseAndCheckAlignment(document.body, '');

  // Attach the namespace to the window object, making it accessible from other scripts
  window.detect = detect;

})();
