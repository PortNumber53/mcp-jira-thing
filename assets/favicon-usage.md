# Favicon and Logo Usage Guide

This document provides instructions for using the generated favicons and logos in your MCP JIRA THING SaaS application.

## Generated Assets

The following assets have been generated from your logo:

- `favicon-16x16.png` - 16x16 favicon (browser tabs)
- `favicon-32x32.png` - 32x32 favicon (browser tabs, bookmarks)
- `favicon-192x192.png` - 192x192 favicon (Android home screen)
- `favicon-512x512.png` - 512x512 favicon (high-res, PWA)
- `apple-touch-icon.png` - 180x180 Apple Touch Icon (iOS home screen)
- `logo-small.png` - Small horizontal logo for headers/navigation

## HTML Implementation

Add the following code to the `<head>` section of your HTML files:

```html
<!-- Favicons -->
<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon-192x192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/assets/favicon-512x512.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">

<!-- Optional: Web App Manifest -->
<link rel="manifest" href="/manifest.json">
```

## Web App Manifest (Optional)

Create a `manifest.json` file in your public directory for PWA support:

```json
{
  "name": "MCP JIRA THING",
  "short_name": "MCP JIRA",
  "description": "Your MCP JIRA integration SaaS",
  "icons": [
    {
      "src": "/assets/favicon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/assets/favicon-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "theme_color": "#00d4ff",
  "background_color": "#000000",
  "display": "standalone",
  "start_url": "/"
}
```

## Using the Small Logo

The `logo-small.png` can be used in your navigation bar or header:

```html
<header>
  <img src="/assets/logo-small.png" alt="MCP JIRA THING" height="40">
</header>
```

Or in React/JSX:

```jsx
<header>
  <img src="/assets/logo-small.png" alt="MCP JIRA THING" height={40} />
</header>
```

## Notes

- All images have transparent backgrounds
- The gradient border goes from cyan/blue to pink/purple
- Images are optimized for their respective use cases
- For best results, serve these assets from a CDN in production
