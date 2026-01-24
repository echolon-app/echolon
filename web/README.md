# @echolon/web

Embeddable API reference and testing tool - the web version of Echolon.

## Installation

### Via CDN

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@echolon/web/dist/echolon-web.css">
<script src="https://cdn.jsdelivr.net/npm/@echolon/web/dist/echolon-web.umd.js"></script>
```

### Via npm

```bash
npm install @echolon/web
```

## Usage

### Basic Embed (CDN)

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@echolon/web/dist/echolon-web.css">
</head>
<body>
  <!-- Container where Echolon will be mounted -->
  <div id="echolon"></div>
  
  <!-- Configuration via data attributes -->
  <script
    id="api-reference"
    data-url="/openapi.json"
    data-cors-proxy="https://proxy.echolon.app"
  ></script>
  
  <script src="https://cdn.jsdelivr.net/npm/@echolon/web/dist/echolon-web.umd.js"></script>
</body>
</html>
```

### Configuration Options

| Attribute | Description | Default |
|-----------|-------------|---------|
| `data-url` | URL to your OpenAPI/Swagger spec (JSON or YAML) | Required |
| `data-cors-proxy` | CORS proxy URL prefix (e.g., `https://proxy.com/?url=`) | None |
| `data-theme` | Theme: `light`, `dark`, or `system` | `system` |
| `data-view` | Default view: `tabs` or `reference` | `reference` |

### ES Module Import

```javascript
import { mount } from '@echolon/web';

mount({
  container: '#echolon',
  specUrl: '/openapi.json',
  corsProxy: 'https://proxy.echolon.app/',
  theme: 'dark',
  viewMode: 'reference',
});
```

## Features

- **API Reference View**: All endpoints displayed in a vertical scrollable list
- **Interactive Testing**: Execute requests directly from the browser
- **CORS Proxy Support**: Configure a proxy for cross-origin requests
- **Theme Support**: Light, dark, and system themes
- **Environment Variables**: Define and use variables in requests
- **OpenAPI/Swagger Import**: Automatically parse and display your API spec

## CORS Considerations

Browsers restrict cross-origin requests for security. When testing APIs from different domains, you'll need a CORS proxy. Options include:

1. **Self-hosted proxy**: Deploy your own CORS proxy server
2. **CORS Anywhere**: Use `https://proxy.echolon.app` (requires activation)
3. **Server-side configuration**: Add CORS headers to your API

Configure the proxy using the `data-cors-proxy` attribute.

## License

MIT

