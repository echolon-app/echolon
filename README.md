# Echolon

A powerful, git-native and local-first API client built with Electron and React.

## Features

- **Collections & Requests**: Organize your API requests in collections and folders
- **Environment Variables**: Manage different environments with variables
- **Request Builder**: Full-featured request builder with params, headers, body, auth
- **Response Viewer**: View responses with syntax highlighting and search
- **API Mocking**: Advanced API mocking features
- **History**: Track all your request history
- **Swagger Import**: Import OpenAPI/Swagger files
- **cURL Export**: Export requests as cURL commands
- **Dark/Light Mode**: Beautiful themes for any preference
- **Completely Local**: All data stored locally, no account required

## Development

### Repo structure

- core -> Echolon electron app
- web -> Echolon web version

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
cd core
# Install dependencies
npm install

# Start development server
npm run dev
```

### Building

```bash
cd core
# Build for all platforms
npm run package:all

# Build for specific platform
npm run package:mac
npm run package:win
npm run package:linux
```

### Code Signing (Optional)

For macOS code signing, set these environment variables:

```bash
CSC_LINK=/path/to/certificate.p12
CSC_KEY_PASSWORD=certificate_password
APPLE_ID=your@email.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=XXXXXXXXXX
```

For Windows code signing:

```bash
CSC_LINK=/path/to/certificate.pfx
CSC_KEY_PASSWORD=certificate_password
```

## Tech Stack

- **Electron** - Cross-platform desktop app
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Fast bundler
- **Ace Editor** - Code/JSON viewer

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── index.ts    # Main entry
│   ├── menu.ts     # Application menu
│   ├── preload.ts  # Preload script
│   └── updater.ts  # Auto-update logic
├── renderer/       # React app
│   ├── components/ # UI components
│   ├── contexts/   # React Context providers
│   ├── hooks/      # Custom hooks
│   ├── services/   # Business logic
│   ├── styles/     # Global styles
│   ├── types/      # TypeScript types
│   └── utils/      # Utility functions
└── shared/         # Shared code
    └── constants.ts
```

## License

MIT

