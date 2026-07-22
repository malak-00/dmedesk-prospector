# Chrome-Extension - Getting Started

**Pages:** 11

---

## Run scripts on every page Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-on-every-tab

**Contents:**
- Run scripts on every page Stay organized with collections Save and categorize content based on your preferences.
- Overview
- Before you start
- Build the extension
  - Step 1: Add information about the extension
  - Step 2: Provide the icons
  - Step 3: Declare the content script
  - Step 4: Calculate and insert the reading time
  - Step 5: Listen for changes
- Test that it works

Create your first extension that inserts a new element on the page.

This tutorial builds an extension that adds the expected reading time to any Chrome extension and Chrome Web Store documentation page.

In this guide, we're going to explain the following concepts:

This guide assumes that you have basic web development experience. We recommend checking out the Hello world tutorial for an introduction to the extension development workflow.

To start, create a new directory called reading-time to hold the extension's files. If you prefer, you can download the complete source code from GitHub.

The manifest JSON file is the only required file. It holds important information about the extension. Create a manifest.json file in the root of the project and add the following code:

These keys contain basic metadata for the extension. They control how the extension appears on the extensions page and, when published, on the Chrome Web Store. To dive deeper, check out the "name", "version" and "description" keys on the Manifest overview page.

💡 Other facts about the extension manifest

So, why do you need icons? Although icons are optional during development, they are required if you plan to distribute your extension on the Chrome Web Store. They also appear in other places like the Extensions Management page.

Create an images folder and place the icons inside. You can download the icons on GitHub. Next, add the highlighted code to your manifest to declare icons:

We recommend using PNG files, but other file formats are allowed, except for SVG files.

💡 Where are these differently-sized icons displayed?

Extensions can run scripts that read and modify the content of a page. These are called content scripts. They live in an isolated world, meaning they can make changes to their JavaScript environment without conflicting with their host page or other extensions' content scripts.

Add the following code to the manifest.json to register a content script called content.js.

The "matches" field can have one or more match patterns. These allow the browser to identify which sites to inject the content scripts into. Match patterns consist of three parts: <scheme>://<host><path>. They can contain '*' characters.

💡 Does this extension display a permission warning?

When a user installs an extension, the browser informs them what the extension can do. Content scripts request permission to run on sites that meet the match pattern criteria.

In this example, the user would se

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Reading time",
  "version": "1.0",
  "description": "Add the reading time to Chrome Extension documentation articles"
}
```

Example 2 (unknown):
```unknown
{
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  }
}
```

Example 3 (unknown):
```unknown
{
  "content_scripts": [
    {
      "js": ["scripts/content.js"],
      "matches": [
        "https://developer.chrome.com/docs/extensions/*",
        "https://developer.chrome.com/docs/webstore/*"
      ]
    }
  ]
}
```

Example 4 (javascript):
```javascript
function renderReadingTime(article) {
  // If we weren't provided an article, we don't need to render anything.
  if (!article) {
    return;
  }

  const text = article.textContent;
  const wordMatchRegExp = /[^\s]+/g; // Regular expression
  const words = text.matchAll(wordMatchRegExp);
  // matchAll returns an iterator, convert to array to get word count
  const wordCount = [...words].length;
  const readingTime = Math.round(wordCount / 200);
  const badge = document.createElement("p");
  // Use the same styling as the publish information in an article's header
  badge.classList.add("color-
...
```

---

## 

**URL:** https://developer.chrome.com/docs/extensions/mv3/getstarted

**Contents:**
  - Get started
- Overview
  - What are extensions?
  - How are they built?
  - What can they do?
- Extension terminology
  - Manifest
  - Service workers
  - Content scripts
  - Toolbar action

---

## Debug extensions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/get-started/tutorial/debug

**Contents:**
- Debug extensions Stay organized with collections Save and categorize content based on your preferences.
- Before you begin
- Break the extension
  - Debug the manifest
  - Debug the service worker
    - Locating logs
    - Locating errors
    - Check the service worker status
  - Debug the popup
  - Debug content scripts

Extensions can access the same Chrome DevTools as web pages. To become an expert in debugging extensions, you will need to know how to locate logs and errors of the different extension components. This tutorial provides fundamental techniques for debugging your extension.

This guide assumes that you have basic web development experience. We recommend reading Development Basics for an introduction to the extension development workflow. Design the user interface gives you an introduction to the user interface elements available in extensions.

This tutorial will break one extension component at a time and then demonstrate how to fix it. Remember to undo the bugs introduced in one section before continuing to the next section. Start by downloading the Broken Color sample on GitHub.

First, let's break the manifest file by changing the "version" key to "versions":

Now let's try loading the extension locally. You will see an error dialog box pointing to the problem:

When a manifest key is invalid the extension fails to load, but Chrome gives you a hint of how to fix the problem.

Undo that change and enter an invalid permission to see what happens. Change the "activeTab" permission to lowercase "activetab":

Save the extension and try loading it again. It should load successfully this time. In the extension Management page you will see three buttons: Details, Remove and Errors. The Errors button label turns red when there's an error. Click the Errors button to see the following error:

Before moving on, change the permission back, click Clear all in the upper right-hand corner to clear the logs, and reload the extension.

The service worker sets the default color to storage and logs it to the console. To view this log, open the Chrome DevTools panel by selecting the blue link next to Inspect views.

Let's break the service worker by changing onInstalled to lowercase oninstalled:

Refresh and click Errors to view the error log. The first error lets you know that the service worker failed to register. This means something went wrong during initiation:

The actual error comes after:

Undo the bug we introduced, click Clear all in the upper right-hand corner, and reload the extension.

You can identify when the service worker wakes up to perform tasks by following these steps:

Open your manifest file in the browser. For example:

Navigate to the Application panel.

Go to the Service Workers pane.

To test your code, start or stop the service worker using the li

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Broken Background Color",
  "version": "1.0",
  "versions": "1.0",
  "description": "Fix an Extension!",
  ...
}
```

Example 2 (unknown):
```unknown
Failed to load extension
Required value version is missing or invalid. It must be between 1-4 dot-separated integers each between 0 and 65536.
Could not load manifest.
```

Example 3 (unknown):
```unknown
{
  ...
  "permissions": ["activeTab", "scripting", "storage"],
  "permissions": ["activetab", "scripting", "storage"],
  ...
}
```

Example 4 (unknown):
```unknown
Permission 'activetab' is unknown or URL pattern is malformed.
```

---

## Hello World extension Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world

**Contents:**
- Hello World extension Stay organized with collections Save and categorize content based on your preferences.
- Overview
- Hello World
- Load an unpacked extension
- Pin the extension
- Reload the extension
  - When to reload the extension
- Find console logs and errors
  - Console logs
  - Error logs

Learn the basics of Chrome extension development by building your first Hello World extension.

You will create a "Hello World" example, load the extension locally, locate logs, and explore other recommendations.

This extension will display “Hello Extensions” when the user clicks the extension toolbar icon.

Start by creating a new directory to store your extension files. If you prefer, you can download the full source code from GitHub.

Next, create a new file in this directory called manifest.json. This JSON file describes the extension's capabilities and configuration. For example, most manifest files contain an "action" key which declares the image Chrome should use as the extension's action icon and the HTML page to show in a popup when the extension's action icon is clicked.

Download the icon to your directory, and be sure to change its name to match what's in the "default_icon" key.

For the popup, create a file named hello.html, and add the following code:

The extension now displays a popup when the extension's action icon (toolbar icon) is clicked. You can test it in Chrome by loading it locally. Ensure all files are saved.

To load an unpacked extension in developer mode:

Ta-da! The extension has been successfully installed. If no extension icons were included in the manifest, a generic icon will be created for the extension.

By default, when you load your extension locally, it will appear in the extensions menu (). Pin your extension to the toolbar to quickly access your extension during development.

Click the extension's action icon (toolbar icon); you should see a popup.

Go back to the code and change the name of the extension to "Hello Extensions of the world!" in the manifest.

After saving the file, to see this change in the browser you also have to refresh the extension. Go to the Extensions page and click the refresh icon next to the on/off toggle:

The following table shows which components need to be reloaded to see changes:

During development, you can debug your code by accessing the browser console logs. In this case, we will locate the logs for the popup. Start by adding a script tag to hello.html.

Create a popup.js file and add the following code:

To see this message logged in the Console:

Now let's break the extension. We can do so by removing the closing quote in popup.js:

Go to the Extensions page and open the popup. An Errors button will appear.

Click the Errors button to learn more about the error:

To learn more a

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Hello Extensions",
  "description": "Base Level Extension",
  "version": "1.0",
  "manifest_version": 3,
  "action": {
    "default_popup": "hello.html",
    "default_icon": "hello_extensions.png"
  }
}
```

Example 2 (unknown):
```unknown
<html>
  <body>
    <h1>Hello Extensions</h1>
  </body>
</html>
```

Example 3 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Hello Extensions of the world!",
  ...
}
```

Example 4 (unknown):
```unknown
<html>
  <body>
    <h1>Hello Extensions</h1>
    <script src="popup.js"></script>
  </body>
</html>
```

---

## 

**URL:** https://developer.chrome.com/docs/extensions/get-started#tutorials

**Contents:**
  - Get started
- Overview
  - What are extensions?
  - How are they built?
  - What can they do?
- Extension terminology
  - Manifest
  - Service workers
  - Content scripts
  - Toolbar action

---

## Handle events with service workers Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/get-started/tutorial/service-worker-events

**Contents:**
- Handle events with service workers Stay organized with collections Save and categorize content based on your preferences.
- Overview
- Before you start
- Build the extension
  - Step 1: Register the service worker
  - Step 2: Import multiple service worker modules
  - Optional: Debugging the service worker
  - Step 4: Initialize the state
  - Step 5: Register your events
  - Step 6: Set up a recurring event

Tutorial that covers extension service worker concepts

This tutorial provides an introduction to Chrome Extension service workers. As part of this tutorial, you will build an extension that allows users to quickly navigate to Chrome API reference pages using the omnibox. You will learn how to:

This guide assumes that you have basic web development experience. We recommend reviewing Extensions 101 and Hello World for an introduction to extension development.

Start by creating a new directory called quick-api-reference to hold the extension files, or download the source code from our GitHub samples repository.

Create the manifest file in the root of the project and add the following code:

Extensions register their service worker in the manifest, which only takes a single JavaScript file. There's no need to call navigator.serviceWorker.register(), like you would in a web page.

Create an images folder then download the icons into it.

Check out the first steps of the Reading time tutorial to learn more about the extension's metadata and icons in the manifest.

Our service worker implements two features. For better maintainability, we will implement each feature in a separate module. First, we need to declare the service worker as an ES Module in our manifest, which allows us to import modules in our service worker:

Create the service-worker.js file and import two modules:

Create these files and add a console log to each one.

See Importing scripts to learn about other ways to import multiple files in a service worker.

I'll explain how to find the service worker logs and know when it has terminated. First, follow the instructions to Load an unpacked extension.

After 30 seconds you will see "service worker (inactive)" which means the service worker has terminated. Click the "service worker (inactive)" link to inspect it. The following animation shows this.

Did you notice that inspecting the service worker woke it up? Opening the service worker in the devtools will keep it active. To make sure that your extension behaves correctly when your service worker is terminated, remember to close DevTools.

Now, break the extension to learn where to locate errors. One way to do this is to delete ".js" from the './sw-omnibox.js' import in the service-worker.js file. Chrome will be unable to register the service worker.

Go back to chrome://extensions and refresh the extension. You will see two errors:

See Debugging extensions for more ways debug the extension s

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Open extension API reference",
  "version": "1.0.0",
  "icons": {
    "16": "images/icon-16.png",
    "128": "images/icon-128.png"
  },
  "background": {
    "service_worker": "service-worker.js"
  }
}
```

Example 2 (unknown):
```unknown
{
 "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
}
```

Example 3 (unknown):
```unknown
import './sw-omnibox.js';
import './sw-tips.js';
```

Example 4 (unknown):
```unknown
Service worker registration failed. Status code: 3.

An unknown error occurred when fetching the script.
```

---

## Inject scripts into the active tab Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-activetab

**Contents:**
- Inject scripts into the active tab Stay organized with collections Save and categorize content based on your preferences.
- Overview
- Before you start
- Build the extension
  - Step 1: Add the extension data and icons
  - Step 2: Initialize the extension
  - Step 3: Enable the extension action
    - Use the activeTab permission to protect user privacy
  - Step 4: Track the state of the current tab
  - Step 5: Add or remove the style sheet

Simplify the styling of the current page by clicking the extension toolbar icon.

This tutorial builds an extension that simplifies the styling of the Chrome extension and Chrome Web Store documentation pages so that they are easier to read.

In this guide, we're going to explain how to do the following:

This guide assumes that you have basic web development experience. We recommend checking out Hello World for an introduction to the extension development workflow.

To start, create a new directory called focus-mode that will hold the extension's files. If you prefer, you can download the complete source code from GitHub.

Create a file called manifest.json and include the following code.

To learn more about these manifest keys, check out the "Run scripts on every tab" tutorial that explains the extension's metadata and icons in more detail.

Create an images folder then download the icons into it.

Extensions can monitor browser events in the background using the extension's service worker. Service workers are special JavaScript environments that handle events and terminate when they're not needed.

Start by registering the service worker in the manifest.json file:

Create a file called background.js and add the following code:

The first event our service worker will listen for is runtime.onInstalled(). This method allows the extension to set an initial state or complete some tasks on installation. Extensions can use the Storage API and IndexedDB to store the application state. In this case, though, since we're only handling two states, we will use the action's badge text itself to track whether the extension is 'ON' or 'OFF'.

The extension action controls the extension's toolbar icon. So whenever the user clicks the extension icon, it will either run some code (like in this example) or display a popup. Add the following code to declare the extension action in the manifest.json file:

The activeTab permission grants the extension temporary ability to execute code on the active tab. It also allows access to sensitive properties of the current tab.

This permission is enabled when the user invokes the extension. In this case, the user invokes the extension by clicking on the extension action.

💡 What other user interactions enable the activeTab permission in my own extension?

The "activeTab" permission allows users to purposefully choose to run the extension on the focused tab; this way, it protects the user's privacy. Another benefit is that it does n

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Focus Mode",
  "description": "Enable focus mode on Chrome's official Extensions and Chrome Web Store documentation.",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  }
}
```

Example 2 (unknown):
```unknown
{
  ...
  "background": {
    "service_worker": "background.js"
  },
  ...
}
```

Example 3 (javascript):
```javascript
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({
    text: "OFF",
  });
});
```

Example 4 (unknown):
```unknown
{
  ...
  "action": {
    "default_icon": {
      "16": "images/icon-16.png",
      "32": "images/icon-32.png",
      "48": "images/icon-48.png",
      "128": "images/icon-128.png"
    }
  },
  ...
}
```

---

## Manage tabs Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/get-started/tutorial/popup-tabs-manager

**Contents:**
- Manage tabs Stay organized with collections Save and categorize content based on your preferences.
- Overview
- Before you start
- Build the extension
  - Step 1: Add the extension data and icons
  - Step 2: Create and style the popup
  - Step 3: Manage the tabs
    - Request permission
    - Query the tabs
    - Focus on a tab

Build your first tabs manager.

This tutorial builds a tabs manager to organize your Chrome extension and Chrome Web store documentation tabs.

In this guide, we're going to explain how to do the following:

This guide assumes that you have basic web development experience. We recommend checking out Hello World for an introduction to the extension development workflow.

To start, create a new directory called tabs-manager to hold the extension's files. If you prefer, you can download the complete source code on GitHub.

Create a file called manifest.json and add the following code:

To learn more about these manifest keys, check out the Reading time tutorial that explains the extension's metadata and icons in more detail.

Create an images folder then download the icons into it.

The Action API controls the extension action (toolbar icon). When the user clicks on the extension action, it will either run some code or open a popup, like in this case. Start by declaring the popup in the manifest.json:

A popup is similar to a web page with one exception: it can't run inline JavaScript. Create a popup.html file and add the following code:

Next, you'll style the popup. Create a popup.css file and add the following code:

The Tabs API allows an extension to create, query, modify, and rearrange tabs in the browser.

Many methods in the Tabs API can be used without requesting any permission. However, we need access to the title and the URL of the tabs; these sensitive properties require permission. We could request "tabs" permission, but this would give access to the sensitive properties of all tabs. Since we are only managing tabs of a specific site, we will request narrow host permissions.

Narrow host permissions allow us to protect user privacy by granting elevated permission to specific sites. This will grant access to the title, and URL properties, as well as additional capabilities. Add the highlighted code to the manifest.json file:

💡 What are the main differences between the tabs permission and host permissions?

Both the "tabs" permission and host permissions have drawbacks.

The "tabs" permission grants an extension the ability to read sensitive data on all tabs. Over time, this information could be used to collect a user's browsing history. As such, if you request this permission Chrome will display the following warning message at install time:

Host permissions allow an extension to read and query a matching tab's sensitive properties, plus inject 

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "manifest_version": 3,
  "name": "Tab Manager for Chrome Dev Docs",
  "version": "1.0",
  "icons": {
    "16": "images/icon-16.png",
    "32": "images/icon-32.png",
    "48": "images/icon-48.png",
    "128": "images/icon-128.png"
  }
}
```

Example 2 (unknown):
```unknown
{
  "action": {
    "default_popup": "popup.html"
  }
}
```

Example 3 (unknown):
```unknown
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="./popup.css" />
  </head>
  <body>
    <template id="li_template">
      <li>
        <a>
          <h3 class="title">Tab Title</h3>
          <p class="pathname">Tab Pathname</p>
        </a>
      </li>
    </template>

    <h1>Google Dev Docs</h1>
    <button>Group Tabs</button>
    <ul></ul>

    <script src="./popup.js" type="module"></script>
  </body
...
```

Example 4 (unknown):
```unknown
body {
  width: 20rem;
}

ul {
  list-style-type: none;
  padding-inline-start: 0;
  margin: 1rem 0;
}

li {
  padding: 0.25rem;
}
li:nth-child(odd) {
  background: #80808030;
}
li:nth-child(even) {
  background: #ffffff;
}

h3,
p {
  margin: 0;
}
```

---

## Debug extensions Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/tut_debugging/

**Contents:**
- Debug extensions Stay organized with collections Save and categorize content based on your preferences.
- Before you begin
- Break the extension
  - Debug the manifest
  - Debug the service worker
    - Locating logs
    - Locating errors
    - Check the service worker status
  - Debug the popup
  - Debug content scripts

Extensions can access the same Chrome DevTools as web pages. To become an expert in debugging extensions, you will need to know how to locate logs and errors of the different extension components. This tutorial provides fundamental techniques for debugging your extension.

This guide assumes that you have basic web development experience. We recommend reading Development Basics for an introduction to the extension development workflow. Design the user interface gives you an introduction to the user interface elements available in extensions.

This tutorial will break one extension component at a time and then demonstrate how to fix it. Remember to undo the bugs introduced in one section before continuing to the next section. Start by downloading the Broken Color sample on GitHub.

First, let's break the manifest file by changing the "version" key to "versions":

Now let's try loading the extension locally. You will see an error dialog box pointing to the problem:

When a manifest key is invalid the extension fails to load, but Chrome gives you a hint of how to fix the problem.

Undo that change and enter an invalid permission to see what happens. Change the "activeTab" permission to lowercase "activetab":

Save the extension and try loading it again. It should load successfully this time. In the extension Management page you will see three buttons: Details, Remove and Errors. The Errors button label turns red when there's an error. Click the Errors button to see the following error:

Before moving on, change the permission back, click Clear all in the upper right-hand corner to clear the logs, and reload the extension.

The service worker sets the default color to storage and logs it to the console. To view this log, open the Chrome DevTools panel by selecting the blue link next to Inspect views.

Let's break the service worker by changing onInstalled to lowercase oninstalled:

Refresh and click Errors to view the error log. The first error lets you know that the service worker failed to register. This means something went wrong during initiation:

The actual error comes after:

Undo the bug we introduced, click Clear all in the upper right-hand corner, and reload the extension.

You can identify when the service worker wakes up to perform tasks by following these steps:

Open your manifest file in the browser. For example:

Navigate to the Application panel.

Go to the Service Workers pane.

To test your code, start or stop the service worker using the li

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Broken Background Color",
  "version": "1.0",
  "versions": "1.0",
  "description": "Fix an Extension!",
  ...
}
```

Example 2 (unknown):
```unknown
Failed to load extension
Required value version is missing or invalid. It must be between 1-4 dot-separated integers each between 0 and 65536.
Could not load manifest.
```

Example 3 (unknown):
```unknown
{
  ...
  "permissions": ["activeTab", "scripting", "storage"],
  "permissions": ["activetab", "scripting", "storage"],
  ...
}
```

Example 4 (unknown):
```unknown
Permission 'activetab' is unknown or URL pattern is malformed.
```

---

## 

**URL:** https://developer.chrome.com/docs/extensions/get-started

**Contents:**
  - Get started
- Overview
  - What are extensions?
  - How are they built?
  - What can they do?
- Extension terminology
  - Manifest
  - Service workers
  - Content scripts
  - Toolbar action

---

## 

**URL:** https://developer.chrome.com/docs/extensions/mv3/getstarted/

**Contents:**
  - Get started
- Overview
  - What are extensions?
  - How are they built?
  - What can they do?
- Extension terminology
  - Manifest
  - Service workers
  - Content scripts
  - Toolbar action

---
