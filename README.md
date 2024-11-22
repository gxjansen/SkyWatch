# BlueSky Follower Tracker

## Overview
A TypeScript application to track and display BlueSky followers using MongoDB and Express.

## Prerequisites
- Node.js
- MongoDB running locally

## Setup
1. Clone the repository
2. Run `npm install`
3. Create a `.env` file with the following:
   ```
   BLUESKY_HANDLE=your_bluesky_handle
   BLUESKY_PASSWORD=your_bluesky_app_password
   MONGODB_URI=mongodb://localhost:27017/bsky_follower_tracker
   ```

## Running the Application

### Fetch Followers (CLI Mode)
```bash
npm start
```
This will authenticate, fetch followers, and store them in MongoDB.

### Web Interface
```bash
npm run server
```
Open `http://localhost:3000` in your browser to view followers.

### Development Mode
```bash
npm run dev
```
Runs the application with auto-reload for development.

## Features
- Fetch BlueSky followers
- Store followers in MongoDB
- Web interface to display followers
- TypeScript implementation
