#!/bin/bash

# Script to start the dashboard development server
# This will build and serve the dashboard on port 1420 for preview

cd /workspaces/AetherCore/packages/dashboard

echo "🚀 Starting AetherCore Tactical Glass Dashboard..."
echo "   Building frontend assets..."

# Build the frontend
npm run build

echo ""
echo "✅ Build complete!"
echo ""
echo "📊 Dashboard can be accessed at: http://localhost:1420"
echo "   (Use 'npm run dev' for development mode with hot reload)"
echo ""
echo "🎬 Dummy data has been initialized for screenshots:"
echo "   - 8 tactical nodes with realistic positions"
echo "   - Movement tracks for visualization"
echo "   - Sample security events"
echo ""
echo "📸 Ready for screenshots!"
