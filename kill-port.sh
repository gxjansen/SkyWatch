#!/bin/bash

# Function to kill processes using a specific port
kill_port() {
    local port=$1
    echo "Attempting to kill processes using port $port"
    
    # macOS method
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Find and kill processes using the port
        lsof -ti:$port | xargs kill -9 2>/dev/null
    fi

    # Linux method
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Find and kill processes using the port
        fuser -k $port/tcp 2>/dev/null
        lsof -ti:$port | xargs kill -9 2>/dev/null
    fi

    # Fallback method for all systems
    if command -v netstat &> /dev/null; then
        # Find PIDs using the port and kill them
        netstat -tulpn | grep :$port | awk '{print $7}' | cut -d'/' -f1 | xargs kill -9 2>/dev/null
    fi

    # Verify port is free
    if nc -z localhost $port 2>/dev/null; then
        echo "Warning: Port $port still in use after killing processes"
    else
        echo "Port $port is now free"
    fi
}

# Kill port 3000
kill_port 3000

# Optional: Add a small delay to ensure port is fully released
sleep 1
