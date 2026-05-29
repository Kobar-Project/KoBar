const { JSDOM } = require('jsdom');
const dom = new JSDOM(`<!DOCTYPE html><div id="editorjs"></div>`, {
  url: "http://localhost/",
  pretendToBeVisual: true
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;

// Import editor.js dynamically since it might be an ES module
async function run() {
  const EditorJS = (await import('@editorjs/editorjs')).default;
  const List = (await import('@editorjs/list')).default;
  const Header = (await import('@editorjs/header')).default;

  const editor = new EditorJS({
    holder: 'editorjs',
    tools: {
      header: Header,
      list: {
        class: List,
        inlineToolbar: true,
      }
    },
    onReady: () => {
      console.log("Editor is ready!");
      
      // Dump all popover item titles
      const popoverItems = document.querySelectorAll('.ce-popover-item__title');
      if (popoverItems.length > 0) {
        console.log("Popover items found:");
        popoverItems.forEach(el => console.log(el.textContent));
      }

      // Instead of relying on DOM, let's look at editor modules
      // This is hacky, but maybe we can trigger the conversion menu
      try {
         // Create a block
         editor.blocks.insert('paragraph', {text: 'test'});
         // Try to open block tunes
         setTimeout(() => {
            const tuneButton = document.querySelector('.ce-toolbar__settings-btn');
            if (tuneButton) {
                tuneButton.click();
                console.log("Clicked tune button");
                setTimeout(() => {
                   const titles = document.querySelectorAll('.ce-popover-item__title');
                   const allTitles = Array.from(titles).map(el => el.textContent);
                   console.log("Convert To Menu Items: ", allTitles);
                }, 500);
            } else {
                console.log("Tune button not found");
            }
         }, 500);
      } catch (e) {
          console.error(e);
      }
    }
  });
}

run();
