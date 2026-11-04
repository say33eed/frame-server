# Frame - Backend API

**Frame Backend** is the server-side application for Frame, a full-stack creative studio marketplace where creators can discover and book creative spaces while studio owners manage their listings.

The backend handles studio data, authentication, authorization, bookings, image references, and database operations through a REST API.

## Live Links

- **Live Website:** https://frame-client.vercel.app
- **Live Backend:** https://frame-server-35c7.onrender.com
- **API Health Check:** https://frame-server-35c7.onrender.com/api/health
- **Frontend GitHub Repository:** https://github.com/say33eed/frame-client
- **Backend GitHub Repository:** https://github.com/say33eed/frame-server

---

## Key Features

1. **RESTful API:** Provides endpoints for studio discovery, studio management, bookings, categories, and other application features.
2. **MongoDB Integration:** Stores studio listings, booking information, and other application data using MongoDB Atlas.
3. **Better Auth:** Supports secure email/password authentication and Google OAuth.
4. **Studio CRUD Operations:** Authenticated users can create, update, and delete their studio listings.
5. **Ownership-Based Authorization:** Users can edit or delete only the studios they own.
6. **Studio Discovery:** Provides public endpoints for retrieving studios, featured listings, and individual studio details.
7. **Booking Management:** Authenticated users can create, view, and cancel eligible bookings.
8. **Booking Conflict Prevention:** Server-side checks help prevent overlapping bookings for the same studio.
9. **Input Validation:** Validates studio details, prices, capacities, image URLs, and booking information.
10. **Image Gallery Support:** Stores primary image URLs and additional gallery image URLs for studio listings.
11. **Security Controls:** Includes authentication checks, protected mutation routes, and request validation.
12. **Deployment:** Hosted on Render and connected to the deployed Next.js frontend.

---

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express.js 5 | Backend web framework |
| MongoDB Atlas | Cloud database |
| MongoDB Node.js Driver | Database operations |
| Better Auth | Authentication and session management |
| Google OAuth | Social authentication |
| REST API | Frontend and backend communication |
| Render | Backend deployment |

The backend uses **CommonJS** modules.

---

## Project Structure

```text
frame-server/
├── betterAuth.js
├── bookingRoutes.js
├── mutationSecurity.js
├── myListingsRoute.js
├── newsletterRoute.js
├── server.js
├── studioCreateRoute.js
├── studioEditRoute.js
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
└── README.md
```

### Important Files

- `server.js` — Express application, database connection, middleware, and public studio routes.
- `betterAuth.js` — Better Auth configuration, session management, and Google OAuth integration.
- `studioCreateRoute.js` — Studio creation endpoint and validation.
- `studioEditRoute.js` — Protected studio retrieval, editing, and deletion.
- `bookingRoutes.js` — Booking creation, retrieval, and cancellation.
- `myListingsRoute.js` — Studio listings associated with the authenticated user.
- `mutationSecurity.js` — Security checks for protected operations.
- `newsletterRoute.js` — Newsletter subscription endpoint.

---

## Installation and Local Setup

### Prerequisites

Before running the backend, install or configure:

- Node.js (a version compatible with the installed dependencies)
- npm
- Git
- MongoDB Atlas
- A MongoDB connection string
- A Better Auth secret
- Google OAuth credentials, if enabling Google sign-in

### 1. Clone the Backend Repository

```bash
git https://github.com/say33eed/frame-server
cd frame-server
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the backend project root.

Use the provided `.env.example` as your starting point.

```env
NODE_ENV=development
PORT=5000

MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING
DB_NAME=frame_db

BETTER_AUTH_SECRET=YOUR_BETTER_AUTH_SECRET
BETTER_AUTH_URL=http://localhost:5000

CLIENT_URL=http://localhost:3000

GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
```

Replace the example values with your actual local configuration.

**Important:**

- Keep `.env` private.
- Do not commit MongoDB credentials, authentication secrets, or OAuth client secrets.
- Configure the correct authorized origins and redirect URLs in your Google OAuth settings.
- Production environment values should be configured in Render rather than committed to GitHub.

### 4. Start the Development Server

```bash
npm run dev
```

The development script uses Node.js watch mode and loads `.env`.

The backend runs at:

http://localhost:5000

### 5. Start the Production Server

```bash
npm start
```

This runs `server.js` without development watch mode.

In production, environment variables should be supplied by the hosting platform.

### 6. Verify the Server

Open:

http://localhost:5000/api/health

You can also check the deployed API:

https://frame-server-35c7.onrender.com/api/health

---

## API Endpoints

The following routes are implemented in the backend source.

### Health and Categories

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Check backend health |
| GET | `/api/categories` | Retrieve studio categories |

### Studio Discovery

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/studios` | Retrieve studio listings |
| GET | `/api/studios?category=photo-studio` | Filter studios by category |
| GET | `/api/studios/featured` | Retrieve featured studios |
| GET | `/api/studios/:id` | Retrieve an individual studio |

### Studio Management

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/studios` | Create a studio |
| GET | `/api/studios/manage/:id` | Retrieve a studio for editing |
| PATCH | `/api/studios/manage/:id` | Update an owned studio |
| DELETE | `/api/studios/manage/:id` | Delete an owned studio |
| GET | `/api/my-listings` | Retrieve the user's studio listings |

Studio creation and management operations are protected by authentication and security middleware.

### Booking Management

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/bookings` | Create a booking |
| GET | `/api/bookings/mine` | Retrieve the current user's bookings |
| PATCH | `/api/bookings/:id/cancel` | Cancel an eligible booking |

### Authentication

Authentication endpoints are handled by Better Auth under:

```text
/api/auth/*
```

The application supports:

- Email and password authentication
- Google OAuth
- Session management
- Authentication checks for protected routes

### Newsletter

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/newsletter` | Submit a newsletter subscription |

The backend also mounts additional security-related routes under `/api/security`.

---

## Studio Data

Studio listings support information such as:

- Studio title
- Category
- Hourly rental rate
- Security deposit
- Maximum capacity
- Location
- Studio description
- Amenities
- Primary image URL
- Gallery image URLs
- Owner information

Studio images are represented by URLs stored with the listing.

The frontend uses imgbb to upload images. The backend stores the resulting image references in MongoDB.

Deleting an image reference from a listing does not automatically delete the hosted image from imgbb.

---

## Authentication and Authorization

Frame uses **Better Auth** to manage user authentication.

Authentication features include:

- Email/password sign-in
- Google sign-in
- User sessions
- Protected API operations

Authorization ensures that authenticated users can manage only the resources they are permitted to access.

For example, users cannot edit or delete another owner's studio through the protected management endpoints.

Authentication and ownership checks are enforced on the server rather than relying only on frontend controls.

---

## Booking System

The booking API supports studio reservation workflows.

Users can:

- Create a booking
- Retrieve their bookings
- Cancel eligible bookings

The server validates booking requests and checks for overlapping reservations.

This helps prevent multiple conflicting bookings for the same studio and time period.

Booking validation takes place on the backend, independently of frontend form validation.

---

## Validation and Security

The backend includes:

- Authentication checks for protected endpoints
- Studio ownership verification
- Server-side input validation
- Booking conflict checks
- Security checks for mutation requests
- Controlled request body size
- Environment-based configuration
- Error responses for invalid requests

Sensitive credentials are stored in environment variables rather than source code.

For production, authentication URLs and trusted origins must match the deployed frontend and backend configuration.

---

## Database

Frame uses **MongoDB Atlas** with the official MongoDB Node.js driver.

The backend connects using the `MONGODB_URI` environment variable.

The database name is configured using `DB_NAME`, with `frame_db` as the default.

The database supports persistent storage for studio listings, bookings, and authentication-related information.

---

## Deployment

The backend is deployed on **Render**.

### Production Backend URL

https://frame-server-35c7.onrender.com

### Production Frontend URL

https://frame-client.vercel.app

### Recommended Render Configuration

| Setting | Value |
|---|---|
| Environment | Node.js |
| Build command | `npm install` |
| Start command | `npm start` |
| Environment variables | Configure in Render dashboard |

Production environment variables should include the MongoDB connection, Better Auth configuration, frontend origin, and Google OAuth credentials where applicable.

**Never upload the production `.env` file to GitHub.**

---

## Testing

### Local API Health Check

Start the backend:

```bash
npm run dev
```

Then visit:

```text
http://localhost:5000/api/health
```

### Studio API

Test the public studio endpoint:

```text
http://localhost:5000/api/studios
```

### Categories API

Test the categories endpoint:

```text
http://localhost:5000/api/categories
```

### Production Verification

Verify the deployed endpoints:

- https://frame-server-35c7.onrender.com/api/health
- https://frame-server-35c7.onrender.com/api/categories
- https://frame-server-35c7.onrender.com/api/studios

### Functional Testing Checklist

- [ ] Backend connects to MongoDB Atlas
- [ ] Health endpoint responds
- [ ] Studio categories load
- [ ] Public studio listings load
- [ ] Email/password authentication works
- [ ] Google authentication works
- [ ] Authenticated user can create a studio
- [ ] Studio owner can update their listing
- [ ] Studio owner can delete their listing
- [ ] Unauthorized users cannot modify another owner's studio
- [ ] Users can create valid bookings
- [ ] Overlapping booking requests are rejected
- [ ] Users can retrieve their bookings
- [ ] Eligible bookings can be cancelled
- [ ] Frontend communicates with the deployed backend

---

## Related Frontend

The frontend is built using Next.js, React, TypeScript, and Tailwind CSS.

It provides the user interface for studio discovery, studio management, authentication, and booking.

**Frontend Live URL:** https://frame-client.vercel.app

**Frontend Repository:** https://github.com/say33eed/frame-client

---

