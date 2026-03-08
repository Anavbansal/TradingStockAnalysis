# My Trading App

## Description

My Trading App is a comprehensive, modern web application built with Angular for stock trading and market analysis. Designed for both novice and experienced traders, it provides a suite of powerful tools to analyze markets, manage portfolios, execute trades, and gain AI-powered insights. The application features real-time data integration, secure authentication, and a responsive design optimized for desktop and mobile devices.

The app leverages serverless architecture with AWS Lambda for backend operations and integrates with TradingView for advanced charting capabilities. It supports various trading instruments including equities, mutual funds, and derivatives, with specialized components for intraday trading, delivery trades, and options analysis.

## Features

### Core Trading Features
- **Intraday Trading**: Real-time order placement and execution for day trading with live market data feeds
- **Delivery Trading**: Long-term investment trading with delivery settlement mechanisms
- **Portfolio Management**: Comprehensive portfolio tracking with performance analytics, P&L calculations, and risk assessment
- **Mutual Funds**: Access to mutual fund data, NAV tracking, and investment analysis tools

### Analytical Tools
- **AI Insights**: Machine learning-powered market predictions and trading recommendations
- **FO Greeks**: Advanced options analysis with delta, gamma, theta, vega, and rho calculations for derivatives trading
- **TradingView Chart Integration**: Professional-grade charting with technical indicators, drawing tools, and multiple timeframes

### User Experience
- **Authentication System**: Secure login/logout with route guards and session management
- **Dashboard**: Centralized view of market overview, watchlists, and quick access to trading tools
- **Responsive Design**: Mobile-first design using Tailwind CSS for optimal viewing on all devices
- **Real-time Market Data**: Live price feeds and market updates through integrated data services

## Tech Stack

### Frontend Framework
- **Angular 21.1.0**: Latest Angular framework with standalone components and modern reactive patterns
- **TypeScript 5.9.2**: Strongly typed JavaScript for better code quality and developer experience
- **RxJS 7.8.0**: Reactive programming library for handling asynchronous operations and state management

### Styling & UI
- **Tailwind CSS 4.1.12**: Utility-first CSS framework for rapid UI development
- **Angular Material/Icons**: Component library for consistent design system (if applicable)

### Development & Build Tools
- **Angular CLI 21.1.4**: Command-line interface for Angular development and project scaffolding
- **Vitest 4.0.8**: Fast unit testing framework with native ES modules support
- **PostCSS 8.5.3**: CSS processing tool for Tailwind and other plugins

### Backend & Infrastructure
- **AWS Lambda**: Serverless compute for watchlist and data processing functions
- **DynamoDB**: NoSQL database for user watchlists and recent searches
- **API Gateway**: RESTful API endpoints for frontend-backend communication

## Architecture Overview

The application follows a modular architecture with clear separation of concerns:

### Frontend Architecture
- **Component-based**: Each feature is encapsulated in its own component with dedicated HTML, CSS, and TypeScript files
- **Service Layer**: Centralized services for API calls, authentication, and data management
- **Route Guards**: Authentication protection for sensitive routes
- **Reactive State**: RxJS observables for real-time data updates and user interactions

### Backend Architecture
- **Serverless Functions**: AWS Lambda handles watchlist operations without server management
- **Database Layer**: DynamoDB provides scalable, low-latency data storage for user preferences
- **API Layer**: RESTful endpoints with proper error handling and validation

### Data Flow
1. User interacts with Angular components
2. Components call services for data operations
3. Services communicate with AWS Lambda via HTTP requests
4. Lambda functions query/update DynamoDB
5. Responses flow back through the same pipeline with real-time updates

## Prerequisites

- **Node.js**: Version 18.0.0 or higher (LTS recommended)
- **npm**: Version 10.9.0 or higher (comes with Node.js)
- **Git**: For version control and cloning the repository
- **AWS Account**: For backend Lambda and DynamoDB access (if deploying)

## Installation

### 1. Clone the Repository
```bash
git clone <repository-url>
cd my-trading-app
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Copilot Tools (Optional)
The project includes additional development tools in the `copilot-tools` directory:
```bash
# For development mode
npm run copilot:tools:dev

# For production mode
npm run copilot:tools:start
```

### 4. Environment Configuration
Create environment files if needed:
- `src/environments/environment.ts` - Development configuration
- `src/environments/environment.prod.ts` - Production configuration

## Running the Application

### Development Mode
```bash
npm start
```
This starts the Angular development server with proxy configuration at `http://localhost:4200`. The proxy forwards API calls to backend services.

### Production Build
```bash
npm run build
```
Builds optimized production assets in the `dist/` directory.

### Watch Mode
```bash
npm run watch
```
Builds and watches for changes during development.

## Testing

### Unit Tests
```bash
npm test
```
Runs unit tests using Vitest with hot reloading and coverage reporting.

### End-to-End Tests
```bash
ng e2e
```
Runs end-to-end tests (requires additional E2E testing framework setup).

## Project Structure

```
src/
├── app/
│   ├── components/               # Feature components
│   │   ├── ai-insights/          # AI market analysis component
│   │   ├── delivery/             # Delivery trading interface
│   │   ├── fo-greeks/            # Options Greeks calculator
│   │   ├── intraday/             # Intraday trading platform
│   │   ├── mutual-funds/         # Mutual fund management
│   │   ├── portfolio/            # Portfolio dashboard
│   │   └── tradingview-chart/    # Chart integration
│   ├── dashboard/                # Main application dashboard
│   ├── auth/                     # Authentication components
│   ├── guards/                   # Route protection guards
│   ├── models/                   # TypeScript interfaces/models
│   └── services/                 # Business logic services
├── public/                       # Static assets (images, icons)
├── index.html                    # Main HTML template
├── main.ts                       # Application bootstrap
└── styles.css                    # Global styles

lambda/
└── watchlist/                    # AWS Lambda function
    ├── index.mjs                 # Lambda handler
    ├── package.json              # Dependencies
    └── README.md                 # Function documentation

docs/                             # Documentation
├── watchlist-dynamodb-contract.md # API specifications
├── copilot/                      # Copilot tool configurations
│   ├── librechat.mcp.example.yaml
│   ├── nginx.reverse-proxy.example.conf
│   └── openapi.yaml
copilot-tools/                    # Development utilities
└── src/server.mjs                # Tool server
```

## Backend Integration

### AWS Lambda Functions
The application uses serverless functions for:
- **Watchlist Management**: Add/remove stocks from user watchlists
- **Recent Searches**: Track and retrieve user's recent stock searches
- **Data Processing**: Handle market data aggregation and caching

### DynamoDB Schema
- **Table**: `anavai_recent_searches`
- **Primary Key**: `userId` (partition key), `searchedAt` (sort key)
- **Attributes**: `symbol` for stock ticker symbols

### API Endpoints
- `GET /prod/watchlist?userId=<user-id>` - Retrieve user's watchlist
- `POST /prod/watchlist` - Add symbol to watchlist

Refer to `docs/watchlist-dynamodb-contract.md` for complete API documentation.

## Configuration

### Proxy Configuration (`proxy.conf.json`)
Configures development server to proxy API requests to backend services:
```json
{
  "/api/*": {
    "target": "https://your-api-gateway-url",
    "secure": true,
    "changeOrigin": true
  }
}
```

### Angular Configuration (`angular.json`)
- Build configurations for development and production
- Asset optimization settings
- Testing framework configuration

### TypeScript Configuration (`tsconfig.json`)
- Compiler options for Angular
- Path mapping for imports
- Strict type checking enabled

## Deployment

### Frontend Deployment
1. Build the application:
   ```bash
   npm run build --prod
   ```

2. Deploy `dist/` contents to your web server (AWS S3, Vercel, Netlify, etc.)

### Backend Deployment
1. Deploy Lambda functions using AWS SAM or Serverless Framework
2. Set up API Gateway for HTTP endpoints
3. Configure DynamoDB tables with proper IAM permissions

### Environment Variables
Set the following environment variables for production:
- `API_BASE_URL`: Backend API endpoint
- `TRADINGVIEW_API_KEY`: TradingView integration key
- `AWS_REGION`: AWS region for Lambda/DynamoDB

## Development Guidelines

### Code Style
- Follow Angular style guide
- Use Prettier for code formatting (configured in `package.json`)
- Maintain TypeScript strict mode
- Write descriptive commit messages

### Component Development
- Use standalone components where possible
- Implement OnPush change detection for performance
- Follow single responsibility principle
- Use reactive forms for complex inputs

### Testing Strategy
- Unit tests for all services and utilities
- Component tests for UI interactions
- Integration tests for critical user flows
- Maintain >80% code coverage

### Git Workflow
1. Create feature branches from `main`
2. Follow conventional commit format
3. Submit pull requests with detailed descriptions
4. Require code review before merging

## API Reference

Detailed API documentation is available in the `docs/` directory:
- `watchlist-dynamodb-contract.md`: Watchlist API specifications
- `copilot/openapi.yaml`: OpenAPI specification for all endpoints

## Troubleshooting

### Common Issues
- **Proxy errors**: Ensure `proxy.conf.json` points to correct backend URL
- **Build failures**: Clear node_modules and reinstall dependencies
- **Test timeouts**: Increase timeout in Vitest configuration
- **CORS issues**: Configure API Gateway CORS settings

### Performance Tips
- Use lazy loading for route modules
- Implement virtual scrolling for large lists
- Optimize images and bundle sizes
- Monitor bundle analyzer output

## Contributing

We welcome contributions! Please follow these steps:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature-name`
3. **Make your changes** following the development guidelines
4. **Run tests**: `npm test`
5. **Commit changes**: Use conventional commit format
6. **Push to branch**: `git push origin feature/your-feature-name`
7. **Create Pull Request**: Provide detailed description of changes

### Code Review Process
- All PRs require review from at least one maintainer
- CI/CD pipeline must pass all checks
- Code coverage must not decrease
- Follow established coding standards

## License

This project is proprietary software owned by [Your Company/Organization]. All rights reserved. Unauthorized use, reproduction, or distribution is prohibited.

## Contact

For questions or support:
- **Email**: support@yourcompany.com
- **Issues**: Use GitHub Issues for bug reports and feature requests
- **Documentation**: Check `docs/` directory for detailed guides

## Additional Resources

- [Angular Documentation](https://angular.dev/)
- [TradingView Charting Library](https://www.tradingview.com/)
- [Tailwind CSS Documentation](https://tailwindcss.com/)
- [Vitest Testing Framework](https://vitest.dev/)
- [AWS Lambda Developer Guide](https://docs.aws.amazon.com/lambda/)
- [DynamoDB Documentation](https://docs.aws.amazon.com/dynamodb/)

---

**Disclaimer**: This application is for educational and informational purposes only. Not intended as financial advice. Always consult with qualified financial advisors before making investment decisions. 
