<div align="center">
  <img src="src/public/images/logo-readme.svg" alt="SkyWatch Logo" width="120" height="120">
  
  # SkyWatch
  
  BlueSky Follower Analytics & Management
  
  [![TypeScript](https://img.shields.io/badge/TypeScript-4.9.5-blue.svg)](https://www.typescriptlang.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-14.x-green.svg)](https://nodejs.org/)
  [![MongoDB](https://img.shields.io/badge/MongoDB-5.x-green.svg)](https://www.mongodb.com/)
</div>

## Features

### Powerful Filtering
Filter your followers based on various criteria to gain insights into your audience:

<img src="src/public/images/filters.png" alt="Available Filters" width="100%">

### Customizable Columns
Control which information you want to see with flexible column controls:

<img src="src/public/images/columns.png" alt="Column Controls" width="100%">

### Detailed User Table
View comprehensive information about your followers in an organized table:

<img src="src/public/images/table2.png" alt="User Table Example" width="100%">

Additional features include:
- Track and analyze your BlueSky followers
- View detailed statistics and metrics
- Filter and sort followers by various criteria
- Manage your following list
- Real-time import progress tracking
- Dark mode interface

## Prerequisites

- Node.js (v14 or higher)
- MongoDB
- BlueSky account

## Setup

1. Clone the repository:
```bash
git clone https://github.com/gxjansen/SkyWatch
cd SkyWatch
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

Required environment variables:
- `BLUESKY_HANDLE`: Your BlueSky handle (e.g., "username.bsky.social")
- `BLUESKY_PASSWORD`: Your BlueSky password
- `MONGODB_URI`: MongoDB connection string
- `PORT`: Server port (default: 3000)
- `AUTO_IMPORT`: Enable automatic follower import on startup (true/false)

4. Build the project:
```bash
npm run build
```

5. Start the server:
```bash
npm run server
```

The application will be available at `http://localhost:3000` (or your configured PORT).

## Development

Start the development server with:
```bash
# Regular start
npm run server

# Force re-import of followers
npm run server:force
```

This will:
- Watch for file changes
- Automatically restart the server
- Enable development logging
- Kill any existing processes on the port (using kill-port.sh)

## Available Commands

- `npm run server`: Start development server with auto-reload
- `npm run server:force`: Start server and force re-import of followers
- `npm run build`: Build the TypeScript project
- `npm start`: Start the core application (without web interface)
- `npm run start:server`: Start the production server
- `npm run kill-port`: Kill any processes running on the configured port

## Security Notes

- Never commit your `.env` file
- Keep your BlueSky credentials secure
- Use environment variables for all sensitive data

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License.
