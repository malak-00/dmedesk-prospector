# Chrome-Extension - Webstore

**Pages:** 1

---

## Best Practices Stay organized with collections Save and categorize content based on your preferences.

**URL:** https://developer.chrome.com/docs/webstore/best-practices

**Contents:**
- Best Practices Stay organized with collections Save and categorize content based on your preferences.
- Overview
- Compliance
- Manifest Version 3
- Security
- Privacy
- Performance and functionality
  - Performance Tooling
  - Avoiding performance pitfalls
    - Back/Forward cache invalidation

This page provides guidelines for designing a high-quality extension and Chrome Web Store listing. These recommendations may be updated as the store continues to grow and we learn from developers' experiences. We strongly encourage you to create extensions that meet standards for compliance, performance, security, and user experience, as described in the following sections.

Extensions that are available in the Chrome Web Store are required to adhere to the developer program policies. If you've received a policy violation warning or want to learn about common violations pitfalls, see Troubleshooting Chrome Web Store violations.

Manifest V3 is the most recent version of the Chrome extension platform and is the required version for submitting new items to the Chrome Web Store. See the Manifest V3 overview to learn about the platform changes. Existing extensions should consider migrating to Manifest V3, see Migrate to Manifest V3 for instructions on how to migrate.

Your extension should be safe for your users. For example, send user data securely via HTTPS or web services security. Check that your extension does not pose security threats and does not use deceptive installation tactics. See Stay secure for a more information.

An extension is required to disclose in the Privacy tab what user data it will collect and how it will handle user data. This information must be accurate, up-to-date, and match the extension's privacy policy. For more guidance on privacy, see Protecting User Privacy policies and the User Data FAQs.

Add end-to-end tests using testing libraries like Puppeteer to make sure your extension is performing as intended from start to finish. In addition, consider conducting thorough manual testing across different browser versions, OSs, and network conditions to ensure smooth functionality.

When you are releasing your extension, there are a number of common performance issues you should make sure to avoid.

The back/forward cache is an optimization built into Chrome that allows for instant loading of a page when a user returns to it. Given extensions can run on every page, its essential you make sure avoid code that prevents that caching, or else you risk substantially slowing down your users. Make sure you test if your extension invalidates the cache. Common causes of cache invalidation include

Unload Handler The unload handler has been deprecated for a long time and should generally never be used. If you are using it, pagehide event is the

*[Content truncated]*

---
