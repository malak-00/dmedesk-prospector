# Chrome-Extension - Testing

**Pages:** 1

---

## End-to-end testing for Chrome Extensions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing

**Contents:**
- End-to-end testing for Chrome Extensions Stay organized with collections Save and categorize content based on your preferences.
- Using browser testing libraries
- Running tests in headless Chrome
- Setting an extension ID
- Testing extension pages
- Testing an extension popup
- Inspecting extension state
- Testing service worker termination

End-to-end testing involves an extension package being built and loaded into a browser. A testing tool communicates with the browser to automate interactions and test the same flows that a user would go through. A library that supports end-to-end testing will generally provide ways of controlling the browser, simulating user input and observing the current state of any open pages.

See Testing Chrome Extensions with Puppeteer for a tutorial and Unit testing for details on writing unit tests for Chrome extensions.

Extensions are supported by a range of testing libraries.

When running tests as part of an automated workflow, it is often necessary to load your extension on a machine that does not have a screen. Chrome's new headless mode allows Chrome to be run in an unattended environment like this. Start Chrome using the --headless=new flag (headless currently defaults to "old", which does not support loading extensions). Depending on the automation tool you choose, there may be a setting that adds the flag for you automatically.

It is often desirable to have a fixed extension ID in tests. This makes many common tasks easier such as allow-listing the extension's origin on a server it needs to communicate with, or opening extension pages within tests. To do this, follow the steps under Keeping a consistent extension ID.

Extension pages can be accessed using their corresponding URL, e.g chrome-extension://<id>/index.html. Use the normal navigation methods available in your automation tool of choice to navigate to these URLs.

Opening an extension popup in the context of another page is not currently possible. Instead, open the popup's URL in a new tab. If your popup uses the active tab, consider implementing an override where a tab ID can be passed explicitly to your popup. For example:

To avoid test failures when you change the internal behavior of your extension, it is generally best practice to avoid accessing internal state in an integration test. Instead, you should base your tests on what is visible to the user. However, it can sometimes be desirable to directly access data from the extension. In these cases, consider executing code in the context of an extension page.

To learn about testing service worker termination, see testing service worker termination with Puppeteer. We also have a sample for Puppeteer and Selenium.

Note that when using some testing frameworks, service workers may not terminate automatically as they would in normal usage. Th

*[Content truncated]*

**Examples:**

Example 1 (javascript):
```javascript
const URL_PARAMS  = new URLSearchParams(window.location.search);

async function getActiveTab() {
  // Open popup.html?tab=5 to use tab ID 5, etc.
  if (URL_PARAMS.has("tab")) {
    return await chrome.tabs.get(parseInt(URL_PARAMS.get("tab")));
  }

  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}
```

Example 2 (javascript):
```javascript
const workerTarget = await browser.waitForTarget(
  target => target.type() === 'service_worker'
);
const worker = await workerTarget.worker();

const value = await worker.evaluate(() => {
  chrome.storage.local.get('foo');
});
```

Example 3 (javascript):
```javascript
// Selenium doesn't allow us to access the service worker, so we need to open an extension page where we can execute the code
await driver.get('chrome-extension://<id>/popup.html');
await driver.executeAsyncScript(
  'const callback = arguments[arguments.length - 1];' +
  'chrome.storage.local.get(\'foo\').then(callback);'
);
```

---
