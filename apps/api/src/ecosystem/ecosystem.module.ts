import { Controller, Get, Module } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * The PayKH ecosystem: "TrustOS is PayKH". A single platform (shared identity,
 * payments, loyalty, notifications) fans out into suffixed products. This
 * registry advertises each product line and the shared services it builds on —
 * the concrete, shipped substrate behind the ecosystem vision.
 */
const PRODUCTS = [
  { id: 'merchant-paykh', name: 'Merchant PayKH', status: 'live', surface: 'dashboard (installable PWA)', description: 'The merchant console: payments, CRM, loyalty, campaigns, games, analytics, AI copilot.' },
  { id: 'fortune-paykh', name: 'Fortune PayKH', status: 'live', surface: 'checkout hosted play + wallet', description: 'Promotional games — scratch cards, spin wheel, lucky draw — on a weighted prize engine with inventory.' },
  { id: 'customer-paykh', name: 'Customer PayKH', status: 'live', surface: 'hosted wallet pass', description: 'A customer loyalty wallet: points, tier, referral QR, and scratch cards.' },
  { id: 'gold-paykh', name: 'Gold PayKH', status: 'planned', surface: 'savings product', description: 'Gold-backed savings / rewards conversion. Planned.' },
  { id: 'learn-paykh', name: 'Learn PayKH', status: 'partial', surface: 'docs & quickstart', description: 'Merchant education — API quickstart, guides, and the developer SDKs (Node/PHP/Python).' },
];

const SHARED_SERVICES = [
  'identity & RBAC (JWT + API keys)',
  'payments & KHQR (Bakong + mock providers)',
  'loyalty, tiers & rewards',
  'segmentation & campaigns',
  'referral & affiliate',
  'promotional prize engine',
  'notifications (Telegram/WhatsApp/SMS/Signal/email) & connectors',
  'analytics, forecasting & accounting ledger',
  'risk scoring & case management',
  'AI copilot with governance',
];

@ApiTags('ecosystem')
@Controller('ecosystem')
export class EcosystemController {
  @Get('products')
  @ApiOperation({ summary: 'The PayKH ecosystem product catalog + shared services' })
  products() {
    return { platform: 'PayKH (TrustOS)', tagline: 'Pay Smart. Grow Together.', products: PRODUCTS, shared_services: SHARED_SERVICES };
  }
}

@Module({ controllers: [EcosystemController] })
export class EcosystemModule {}
