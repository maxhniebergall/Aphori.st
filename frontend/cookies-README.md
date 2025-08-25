# Cookie File Setup

This directory contains a template for cookie files needed for testing. The actual cookie file (`cookies.txt`) is ignored by git to prevent committing sensitive user data.

## Setup for Local Development

1. Copy the example file:
   ```bash
   cp cookies.txt.example cookies.txt
   ```

2. Generate a real temporary user ID by visiting the application locally and extracting the cookie, or use this script:

   ```bash
   # Generate a fresh temp user cookie
   curl -c cookies.txt http://localhost:3000/api/temp-user
   ```

3. The `cookies.txt` file will now contain your local temporary user session and can be used for testing.

## Security Note

Never commit the actual `cookies.txt` file as it contains real user session data. Only the `.example` template should be committed to version control.