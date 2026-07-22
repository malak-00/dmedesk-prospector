# Chrome-Extension - Best Practices

**Pages:** 2

---

## Stay secure Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/mv3/security

**Contents:**
- Stay secure Stay organized with collections Save and categorize content based on your preferences.
- Protect developer accounts
  - Keep groups selective
- Never use HTTP
- Request minimal permissions
  - Cross-origin fetch()
- Limit manifest fields
  - Externally connectable
  - Web-accessible resources
- Include an explicit content security policy

Extensions have access to special privileges within the browser, making them an appealing target for attackers. If an extension is compromised, every user of that extension becomes vulnerable to malicious and unwanted intrusion. Keep an extension secure and its users protected by incorporating these practices.

Extension code is uploaded and updated through Google accounts. If developers' accounts are compromised, an attacker could push malicious code directly to all users. Protect these accounts by by enabling two-factor authentication , preferably with a security key.

If using group publishing, keep the group confined to trusted developers. Do not accept membership requests from unknown persons.

When requesting or sending data, avoid an HTTP connection. Assume that any HTTP connections will have eavesdroppers or contain modifications. HTTPS should always be preferred, as it has built-in security circumventing most man-in-the-middle attacks.

The Chrome browser limits an extension's access to privileges that have been explicitly requested in the manifest. Extensions should minimize their permissions by only registering APIs and websites they depend on.

Limiting an extension's privileges limits what a potential attacker can exploit.

An extension can only use fetch() and XMLHttpRequest() to get resources from the extension and from domains specified in the permissions. Note that calls to both are intercepted by the fetch handler in the service worker.

This extension in the sample above requests access to anything on developer.chrome.com and subdomains of Google by listing "https://developer.chrome.com/*" and "https://*.google.com/*" in the permissions. If the extension were compromised, it would still only have permission to interact with websites that meet the match pattern. The attacker would only have limited ability to access "https://user_bank_info.com", or interact with "https://malicious_website.com".

Including unnecessary keys and permissions in the manifest creates vulnerabilities and makes an extension more visible. Limit manifest fields to those the extension relies on.

Use the "externally_connectable" field to declare which external extensions and web pages the extension will exchange information with. Restrict who the extension can externally connect with to trusted sources.

Making resources accessible by the web, under the "web_accessible_resources" will make an extension detectable by websites and attackers.

The more web accessible r

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
{
  "name": "Very Secure Extension",
  "version": "1.0",
  "description": "Example of a Secure Extension",
  "host_permissions": [
    "https://developer.chrome.com/*",
    "https://*.google.com/*"
  ],
  "manifest_version": 3
}
```

Example 2 (unknown):
```unknown
{
  "name": "Super Safe Extension",
  "externally_connectable": {
    "ids": [
      "iamafriendlyextensionhereisdatas"
    ],
    "matches": [
      "https://developer.chrome.com/*",
      "https://*.google.com/*"
    ],
    "accepts_tls_channel_id": false
  },
  ...
}
```

Example 3 (unknown):
```unknown
{
  ...
  "web_accessible_resources": [
    {
      "resources": [ "test1.png", "test2.png" ],
      "matches": [ "https://web-accessible-resources-1.glitch.me/*" ]
    }
  ]
  ...
}
```

Example 4 (unknown):
```unknown
{
  "name": "Very Secure Extension",
  "version": "1.0",
  "description": "Example of a Secure Extension",
   "content_security_policy": {
    "extension_pages": "default-src 'self'"
  },
  "manifest_version": 3
}
```

---

## Improve extension security Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/extensions/migrating/improve-security

**Contents:**
- Improve extension security Stay organized with collections Save and categorize content based on your preferences.
- Remove execution of arbitrary strings
- Remove remotely hosted code
  - Configuration-driven features and logic
  - Externalized logic with a remote service
  - Embed remotely hosted code in a sandboxed iframe
  - Bundle third-party libraries
  - Use external libraries in tab-injected scripts
  - Inject a function
  - Look for other workarounds

Improving security in Manifest V3

This is the last of three sections describing changes needed for code that is not part of the extension service worker. It describes changes required to improve the security of extensions. The other two sections cover updating your code needed for upgrading to Manifest V3 and replacing blocking web requests.

You can no longer execute external logic using executeScript(), eval(), and new Function().

The executeScript() method is now in the scripting namespace rather than the tabs namespace. For information on updating calls, see Move executeScript().

There are a few special cases in which executing arbitrary strings is still possible:

In Manifest V3, all of your extension's logic must be part of the extension package. You can no longer load and execute remotely hosted files according to Chrome Web Store policy. Examples include:

Alternative approaches are available, depending on your use case and the reason for remote hosting. This section describes approaches to consider. If you are having issues with dealing with remote hosted code, we have guidance available.

Your extension loads and caches a remote configuration (for example a JSON file) at runtime. The cached configuration determines which features are enabled.

Your extension calls a remote web service. This lets you keep code private and change it as needed while avoiding the extra overhead of resubmitting to the Chrome Web Store.

Remotely hosted code is supported in sandboxed iframes. Please note that this approach does not work if the code requires access to the embedding page's DOM.

If you are using a popular framework such as React or Bootstrap that you were previously loading from an external server, you can download the minified files, add them to your project and import them locally. For example:

To include a library in a service worker set the "background.type" key to "module" in the manifest and use an import statement.

You can also load external libraries at runtime by adding them to the files array when calling scripting.executeScript(). You can still load data remotely at runtime.

If you need more dynamism, the new func property in scripting.executeScript() allows you to inject a function as a content script and pass variables using the args property.

In a background script file.

In the background service worker.

The Chrome Extension Samples repo contains a function injection example you can step through. An example of getCurrentTab() is in

*[Content truncated]*

**Examples:**

Example 1 (unknown):
```unknown
<script src="./react-dom.production.min.js"></script>
<link href="./bootstrap.min.css" rel="stylesheet">
```

Example 2 (unknown):
```unknown
chrome.scripting.executeScript({
  target: {tabId: tab.id},
  files: ['jquery-min.js', 'content-script.js']
});
```

---
