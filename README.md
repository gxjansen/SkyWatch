<div align="center">
  <img src="src/public/images/logo-readme.svg" alt="SkyWatch Logo" width="120" height="120">
  
  # SkyWatch
  
  BlueSky Follower Analytics & Management
  
  [![TypeScript](https://img.shields.io/badge/TypeScript-4.9.5-blue.svg)](https://www.typescriptlang.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-14.x-green.svg)](https://nodejs.org/)
  [![MongoDB](https://img.shields.io/badge/MongoDB-5.x-green.svg)](https://www.mongodb.com/)
</div>

## Features

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
git clone https://github.com/yourusername/bsky-follower-tracker.git
cd bsky-follower-tracker
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
npm start
```

The application will be available at `http://localhost:3000` (or your configured PORT).

## Development

Start the development server with:
```bash
npm run dev
```

This will:
- Watch for file changes
- Automatically restart the server
- Enable development logging

## Commands

- `npm run dev`: Start development server
- `npm run build`: Build the project
- `npm start`: Start production server
- `npm run clean`: Clean build directory
- `npm test`: Run tests (when implemented)

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

This project is licensed under the MIT License - see the LICENSE file for details.
