# Use the official Node.js 18 Alpine image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy the package files and install dependencies
COPY package.json yarn.lock ./
RUN yarn install

# Copy the rest of your application code
COPY . ./

# Expose the port the React app runs on
EXPOSE 3000

# Set an environment variable to enable polling for file changes
ENV CHOKIDAR_USEPOLLING=true

# Start the React development server
CMD ["yarn", "start"]
