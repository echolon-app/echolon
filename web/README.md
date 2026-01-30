# @echolon/web

Embeddable API reference and testing tool - the web version of Echolon.

## Installation

## Usage

### Basic Embed (CDN)

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/echolon-app/echolon@v1.1.1/web/dist/echolon-web.css">
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
  
  <script src="https://cdn.jsdelivr.net/gh/echolon-app/echolon@v1.1.1/web/dist/echolon-web.es.js"></script>
</body>
</html>
```

## CORS Considerations

Browsers restrict cross-origin requests for security. When testing APIs from different domains, you'll need a CORS proxy. Options include:

1. **Self-hosted proxy**: Deploy your own CORS proxy server
2. **CORS Anywhere**: Use `https://proxy.echolon.app` (requires activation)
3. **Server-side configuration**: Add CORS headers to your API

Configure the proxy using the `data-cors-proxy` attribute.

## License

MIT

