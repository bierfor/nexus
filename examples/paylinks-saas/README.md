# PayLinks SaaS - Payment Link Generator

A production-ready SaaS application built with Nexus.js that generates payment links with QR codes, powered by Stripe.

## 🚀 Quick Start

### Prerequisites

- Node.js 22+ 
- pnpm (recommended) or npm

### Installation

```bash
# Navigate to the PayLinks directory
cd examples/paylinks-saas

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Generate a secret key for NEXUS_SECRET
# Run this in terminal:
# node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Edit .env and set your NEXUS_SECRET
nano .env

# Initialize database (SQLite for development)
pnpm db:push

# Generate Prisma client
pnpm db:generate
```

### Running the Application

```bash
# Development mode (with hot reload)
pnpm dev

# The app will be available at:
# http://localhost:4000
```

### Demo Login

Use these credentials to access the dashboard:

- **Email:** any valid email (e.g., demo@example.com)
- **Password:** `demo123`

## 📁 Project Structure

```
paylinks-saas/
├── prisma/
│   └── schema.prisma          # Database schema (User, PaymentLink, Transaction, ApiKey)
├── public/
│   └── paylinks.css           # Global styles
├── src/
│   ├── routes/
│   │   ├── +layout.nx         # Root layout with navigation
│   │   ├── +page.nx           # Homepage (redirects to dashboard)
│   │   ├── login/
│   │   │   └── +page.nx       # Login page
│   │   ├── dashboard/
│   │   │   └── +page.nx       # Dashboard with stats
│   │   └── links/
│   │       ├── +page.nx       # All payment links
│   │       └── new/
│   │           └── +page.nx   # Create new payment link
│   └── lib/                   # Shared utilities (TODO)
├── .env.example               # Environment variables template
├── nexus.config.ts            # Nexus configuration
└── package.json
```

## ✨ Features

### Implemented ✅

- **Authentication** - Session-based auth with cookies
- **Dashboard** - Stats overview (total links, revenue, transactions)
- **Payment Links** - Create and manage payment links
- **QR Code Generation** - Automatic QR code creation for each link
- **Form Validation** - Zod-powered validation
- **Rate Limiting** - Built-in protection against abuse
- **CSRF Protection** - Automatic via Nexus Server Actions
- **Responsive Design** - Mobile-friendly UI

### Coming Soon 🚧

- **Stripe Integration** - Real payment processing
- **GraphQL API** - Shield-protected API with JWT auth
- **Vault UI** - Manage secrets (JWT, Stripe keys) with hot-reload
- **Email Notifications** - Payment confirmations
- **Real Database** - PostgreSQL for production

## 🔒 Security Features

Powered by Nexus.js security stack:

- ✅ **CSRF Protection** - Automatic token validation
- ✅ **Rate Limiting** - Per-action throttling
- ✅ **HTTPOnly Cookies** - Secure session storage
- ✅ **Content Security Policy** - XSS prevention
- ✅ **Input Validation** - Zod schemas
- ✅ **Server Actions** - Signed action requests

## 📊 Database Schema

### User
- Authentication and profile data
- Role-based access (user, admin)

### PaymentLink
- Title, description, amount, currency
- URL slug and QR code
- Usage tracking (uses count, max uses)
- Expiration support

### Transaction
- Payment event tracking
- Stripe integration (payment ID, customer)
- Payer information

### ApiKey
- Programmatic access
- Scoped permissions
- Usage tracking

## 🛠️ Development

### Available Scripts

```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Database commands
pnpm db:generate    # Generate Prisma client
pnpm db:push        # Push schema to database
pnpm db:migrate     # Run migrations
pnpm db:studio      # Open Prisma Studio
```

### Environment Variables

Required variables in `.env`:

```bash
# Core (Required)
NEXUS_SECRET="your-32-character-secret-key"
DATABASE_URL="file:./dev.db"

# Stripe (Optional for demo)
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# JWT (Optional for GraphQL API)
JWT_SECRET="another-32-character-secret"
```

## 🚢 Deployment

### Docker Deployment

```bash
# Build image
docker build -t paylinks-saas .

# Run with docker-compose
docker-compose up -d

# Check logs
docker-compose logs -f nexus-app
```

### Manual Deployment

```bash
# Build
pnpm build

# Set environment variables on your server
export NEXUS_SECRET="your-production-secret"
export DATABASE_URL="postgresql://user:pass@host:5432/paylinks"

# Start
node .nexus/output/server.js
```

## 📖 API Documentation

### Server Actions (Available via form POST)

- `loginAction` - User authentication
- `logout` - End session
- `createLinkAction` - Create new payment link

### GraphQL API (Coming Soon)

```graphql
query {
  paymentLinks {
    id
    title
    amount
    qrCodeUrl
  }
}

mutation {
  createPaymentLink(input: {
    title: "Premium"
    amount: 9900
    slug: "premium-2024"
  }) {
    id
    qrCodeUrl
  }
}
```

## 🤝 Contributing

This is an example application showcasing Nexus.js capabilities. Feel free to:

- Fork and customize for your needs
- Report issues or suggest features
- Use as a template for your own SaaS

## 📄 License

MIT - See root LICENSE file

---

Built with ❤️ using [Nexus.js](https://nexusjs.io)
