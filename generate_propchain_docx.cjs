const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, ExternalHyperlink,
  HeadingLevel, BorderStyle, WidthType, ShadingType, VerticalAlign,
  PageNumber, PageBreak, TableOfContents
} = require('docx');
const fs = require('fs');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CONTENT_WIDTH = 9360; // US Letter 8.5" - 2*1" margins = 6.5" = 9360 DXA

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}

function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}

function h3(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [new TextRun({ text, size: 24, font: 'Arial', ...opts.runProps })],
  });
}

function spacer() {
  return new Paragraph({ children: [new TextRun('')], spacing: { after: 120 } });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 24, font: 'Arial' })],
  });
}

function numbered(text) {
  return new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 24, font: 'Arial' })],
  });
}

const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function headerCell(text, width, bgColor = '2E4057') {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bgColor, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20, font: 'Arial' })],
    })],
  });
}

function dataCell(text, width, bgColor = 'FFFFFF') {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bgColor, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      children: [new TextRun({ text: text || '', size: 20, font: 'Arial' })],
    })],
  });
}

// ─── Tables ──────────────────────────────────────────────────────────────────

function coreConceptTable() {
  const col1 = 2200, col2 = 7160;
  const rows = [
    ['Layer', 'What It Means'],
    ['SPV (Building Level)', 'Each building is registered as a separate Special Purpose Vehicle — a legal company entity. All 4 buildings = 4 SPVs.'],
    ['SPV Ownership', 'Each SPV can have up to 100 owners. Ownership is measured in % of the SPV. Flat buyers become SPV stakeholders.'],
    ['Token = SPV %', '1 token = 1 unit of SPV ownership. Buying a flat means buying a specific token allocation in the SPV — no fractions of units.'],
    ['Registry at SPV', 'The SPV holds the flat registry. Buyers are legal owners via SPV stake — not direct individual registry, enabling faster, cleaner transfer.'],
    ['Transfer = Token Sale', 'Selling a flat = transferring your SPV token on-chain. No stamp duty loophole — but significantly faster, auditable, and transparent.'],
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [col1, col2],
    rows: rows.map((row, i) =>
      new TableRow({
        children: [
          i === 0 ? headerCell(row[0], col1) : dataCell(row[0], col1, i % 2 === 0 ? 'F5F5F5' : 'FFFFFF'),
          i === 0 ? headerCell(row[1], col2) : dataCell(row[1], col2, i % 2 === 0 ? 'F5F5F5' : 'FFFFFF'),
        ],
      })
    ),
  });
}

function townshipStructureTable() {
  const cols = [2000, 1840, 1840, 1840, 1840];
  const rows = [
    ['Entity', 'Building A', 'Building B', 'Building C', 'Building D'],
    ['SPV Name', 'Township SPV-1 Pvt Ltd', 'Township SPV-2 Pvt Ltd', 'Township SPV-3 Pvt Ltd', 'Township SPV-4 Pvt Ltd'],
    ['Total Flats', '100 Flats', '100 Flats', '100 Flats', '100 Flats'],
    ['Max SPV Owners', '100 Owners', '100 Owners', '100 Owners', '100 Owners'],
    ['Tokens Issued', '100 Tokens', '100 Tokens', '100 Tokens', '100 Tokens'],
    ['1 Token =', '1 Flat + SPV %', '1 Flat + SPV %', '1 Flat + SPV %', '1 Flat + SPV %'],
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((row, i) =>
      new TableRow({
        children: row.map((cell, j) =>
          i === 0 ? headerCell(cell, cols[j]) : dataCell(cell, cols[j], i % 2 === 0 ? 'F5F5F5' : 'FFFFFF')
        ),
      })
    ),
  });
}

function smartContractsTable() {
  const cols = [2400, 5160, 1800];
  const rows = [
    ['Contract', 'Function', 'Standard'],
    ['SPVToken.sol', 'ERC-20 token representing SPV ownership %. One contract per SPV (building). Minting, burning, transfer controls.', 'ERC-20'],
    ['FlatRegistry.sol', 'Maps each flat ID to a token ID. Links token ownership to physical flat. Stores flat metadata on-chain.', 'Custom'],
    ['SPVMarketplace.sol', 'Primary sale (builder to buyer) and secondary sale (buyer to buyer) escrow + atomic swap logic.', 'Custom'],
    ['ComplianceRegistry.sol', 'Whitelist of KYC-verified wallets. Only whitelisted wallets can hold or receive SPV tokens.', 'Custom'],
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((row, i) =>
      new TableRow({
        children: row.map((cell, j) =>
          i === 0 ? headerCell(cell, cols[j]) : dataCell(cell, cols[j], i % 2 === 0 ? 'F5F5F5' : 'FFFFFF')
        ),
      })
    ),
  });
}

function platformModulesTable() {
  const cols = [2200, 5360, 1800];
  const rows = [
    ['Module', 'Key Features', 'User'],
    ['SPV Onboarding', 'SPV creation, building setup, flat inventory upload, document linking, token minting', 'Builder'],
    ['Buyer KYC & Wallet', 'Aadhaar/PAN verification, wallet creation / linking, compliance whitelist', 'Buyer'],
    ['Primary Marketplace', 'Flat listings, pricing, purchase flow, payment integration, token issuance on confirmation', 'Both'],
    ['Secondary Marketplace', 'Resale listings, offer management, atomic swap settlement, new ownership cert generation', 'Both'],
    ['SPV Cap Table', 'Real-time on-chain stakeholder registry, % ownership per wallet, transfer history', 'Builder / Admin'],
    ['Document Vault', 'IPFS-stored documents, on-chain hash anchoring, download / share, ownership cert generation', 'Both'],
    ['Admin Dashboard', 'Revenue tracking, transaction monitoring, KYC queue, compliance alerts, system health', 'Builder Admin'],
    ['Notification Engine', 'Email + WhatsApp + in-app alerts for transactions, offers, document updates, KYC status', 'Both'],
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((row, i) =>
      new TableRow({
        children: row.map((cell, j) =>
          i === 0 ? headerCell(cell, cols[j]) : dataCell(cell, cols[j], i % 2 === 0 ? 'F5F5F5' : 'FFFFFF')
        ),
      })
    ),
  });
}

function deliveryPlanTable() {
  const cols = [800, 1800, 5060, 1700];
  const rows = [
    ['Week', 'Phase', 'Deliverables', 'Team'],
    ['1', 'Foundation', 'Smart contract architecture finalized, Polygon testnet setup, DB schema design, UI wireframes approved, KYC API integration scoping', 'Blockchain + Backend + Design'],
    ['2', 'Core Contracts', 'SPVToken.sol + FlatRegistry.sol deployed on testnet, ComplianceRegistry.sol live, unit tests complete, backend API scaffolding', 'Blockchain + Backend'],
    ['3', 'Marketplace', 'SPVMarketplace.sol (primary + secondary), payment gateway integration, escrow logic, frontend builder portal v1', 'Full Stack'],
    ['4', 'Buyer Experience', 'Buyer dashboard complete, KYC flow live, wallet integration (MetaMask + WalletConnect), document vault, ownership cert generation', 'Frontend + Backend'],
    ['5', 'Integration & QA', 'End-to-end flow testing (primary + secondary sale), security audit of smart contracts, penetration testing on API, UAT with builder team', 'QA + Security'],
    ['6', 'Launch Prep', 'Mainnet deployment (Polygon), admin training, documentation handover, monitoring setup, 30-day hypercare support begins', 'All Teams'],
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((row, i) =>
      new TableRow({
        children: row.map((cell, j) =>
          i === 0 ? headerCell(cell, cols[j]) : dataCell(cell, cols[j], i % 2 === 0 ? 'F5F5F5' : 'FFFFFF')
        ),
      })
    ),
  });
}

function teamTable() {
  const cols = [2800, 1000, 5560];
  const rows = [
    ['Role', 'Count', 'Responsibility'],
    ['Blockchain Engineers', '2', 'Smart contract development, testnet/mainnet deployment, security audit'],
    ['Backend Engineers', '2', 'API development, database design, payment integration, KYC orchestration'],
    ['Frontend Engineers', '2', 'Builder portal, buyer dashboard, marketplace UI, wallet integration'],
    ['UI/UX Designer', '1', 'Wireframes, design system, user flows, mobile-responsive layouts'],
    ['QA Engineer', '1', 'Test plans, automated testing, security testing, UAT management'],
    ['Project Manager', '1', 'Sprint management, builder coordination, delivery tracking, documentation'],
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((row, i) =>
      new TableRow({
        children: row.map((cell, j) =>
          i === 0 ? headerCell(cell, cols[j]) : dataCell(cell, cols[j], i % 2 === 0 ? 'F5F5F5' : 'FFFFFF')
        ),
      })
    ),
  });
}

function investmentTable() {
  const cols = [5060, 1500, 2800];
  const rows = [
    ['Deliverable', 'Effort', 'Cost (INR)'],
    ['Smart Contract Suite (4 contracts, testnet + mainnet)', '2.5 weeks', '5,50,000'],
    ['Backend API & Database', '3 weeks', '4,00,000'],
    ['Builder Admin Portal (Frontend)', '2 weeks', '2,50,000'],
    ['Buyer Dashboard & Marketplace (Frontend)', '2.5 weeks', '3,00,000'],
    ['KYC Integration & Compliance Module', '1 week', '1,50,000'],
    ['Document Vault & Certificate Engine', '1 week', '1,00,000'],
    ['Payment Gateway Integration', '0.5 weeks', '75,000'],
    ['Security Audit & QA', '1 week', '75,000'],
    ['UI/UX Design System', '1 week', '50,000'],
    ['TOTAL PROJECT INVESTMENT', '6 Weeks', 'INR 20,00,000'],
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((row, i) => {
      const isTotal = i === rows.length - 1;
      return new TableRow({
        children: row.map((cell, j) => {
          if (i === 0) return headerCell(cell, cols[j]);
          if (isTotal) return headerCell(cell, cols[j], '2E4057');
          return dataCell(cell, cols[j], i % 2 === 0 ? 'F5F5F5' : 'FFFFFF');
        }),
      });
    }),
  });
}

function paymentTermsTable() {
  const cols = [2800, 3000, 3560];
  const rows = [
    ['Milestone', 'Payment', 'Trigger'],
    ['Kickoff', 'INR 7,00,000 (35%) — negotiable', 'Agreement signed + project kickoff'],
    ['Smart Contracts Live', 'INR 6,00,000 (30%)', 'All contracts deployed on testnet, UAT started'],
    ['Full Platform Delivery', 'INR 7,00,000 (35%)', 'Mainnet live, all modules delivered, builder trained'],
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((row, i) =>
      new TableRow({
        children: row.map((cell, j) =>
          i === 0 ? headerCell(cell, cols[j]) : dataCell(cell, cols[j], i % 2 === 0 ? 'F5F5F5' : 'FFFFFF')
        ),
      })
    ),
  });
}

function credentialsTable() {
  const cols = [2400, 6960];
  const rows = [
    ['Credential', 'Details'],
    ['Blockchain Clients', 'Uniswap, Decubate, Solidus AI Tech — production-grade DeFi and blockchain infrastructure delivered'],
    ['Core Expertise', 'Hyperledger Besu, EVM smart contracts, DID/VC systems, token engineering, Web3 UX'],
    ['AI Capability', 'In-house AI team — LLM integration, RAG pipelines, agentic systems. Cuechain is our own AI x blockchain product.'],
    ['Team Size', '25+ person team, Indore-based, fully dedicated to client delivery and product innovation'],
    ['Track Record', '50+ delivered projects across Web3, AI, and enterprise software since inception'],
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((row, i) =>
      new TableRow({
        children: row.map((cell, j) =>
          i === 0 ? headerCell(cell, cols[j]) : dataCell(cell, cols[j], i % 2 === 0 ? 'F5F5F5' : 'FFFFFF')
        ),
      })
    ),
  });
}

function riskRegisterTable() {
  const cols = [3400, 1400, 4560];
  const rows = [
    ['Risk', 'Likelihood', 'Mitigation'],
    ['Regulatory change on token-based property ownership', 'Medium', 'SPV structure is legally conservative — no crypto, no fractional sale. Compliant with current MCA and Companies Act framework.'],
    ['KYC API integration delays (NSDL / DigiLocker)', 'Low-Medium', 'Parallel fallback using manual document verification. KYC module is modular — can swap providers.'],
    ['Blockchain gas cost spikes on Polygon mainnet', 'Low', 'Gas costs on Polygon are negligible. Platform pays gas on behalf of users in primary sale flow.'],
    ['Buyer adoption — wallet setup friction', 'Medium', 'Custodial wallet option (platform holds key) for non-crypto buyers. Self-custody optional for advanced users.'],
    ['Smart contract vulnerability', 'Low', 'Independent security audit in Week 5. OpenZeppelin audited base contracts used. Multisig admin controls.'],
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((row, i) =>
      new TableRow({
        children: row.map((cell, j) =>
          i === 0 ? headerCell(cell, cols[j]) : dataCell(cell, cols[j], i % 2 === 0 ? 'F5F5F5' : 'FFFFFF')
        ),
      })
    ),
  });
}

// ─── Document ─────────────────────────────────────────────────────────────────

const doc = new Document({
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: 'numbers',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 24 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: '2E4057' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: '2E4057' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 },
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: '555555' },
        paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 },
      },
    ],
  },
  sections: [
    // ── Cover Page ──────────────────────────────────────────────────────────
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        // Spacer at top
        spacer(), spacer(), spacer(), spacer(),

        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: 'CONFIDENTIAL PRODUCT PROPOSAL', size: 20, font: 'Arial', color: '888888', allCaps: true })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: 'Prepared by Duredev Softwares', size: 20, font: 'Arial', color: '888888' })],
        }),

        spacer(),

        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 160 },
          children: [new TextRun({ text: 'PropChain', size: 72, bold: true, font: 'Arial', color: '2E4057' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: 'Blockchain-Powered SPV Real Estate Platform', size: 32, font: 'Arial', color: '4A90D9' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 480 },
          children: [new TextRun({ text: 'Smart Tokenization of Flat Ownership via SPV Structures', size: 26, font: 'Arial', color: '555555', italics: true })],
        }),

        // Metadata table
        new Table({
          width: { size: 6000, type: WidthType.DXA },
          columnWidths: [3000, 3000],
          rows: [
            new TableRow({ children: [
              headerCell('Project Budget', 3000, '2E4057'),
              headerCell('Delivery Timeline', 3000, '2E4057'),
            ]}),
            new TableRow({ children: [
              dataCell('INR 20,00,000', 3000, 'EEF4FB'),
              dataCell('6 Weeks (1.5 Months)', 3000, 'EEF4FB'),
            ]}),
            new TableRow({ children: [
              headerCell('Technology Stack', 3000, '2E4057'),
              headerCell('Document Date', 3000, '2E4057'),
            ]}),
            new TableRow({ children: [
              dataCell('Blockchain + AI + Web3', 3000, 'EEF4FB'),
              dataCell('April 2026', 3000, 'EEF4FB'),
            ]}),
          ],
        }),

        spacer(), spacer(), spacer(),

        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: 'www.dure.dev', size: 22, font: 'Arial', color: '4A90D9' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: 'Aditya.d@dure.dev  |  +91-9130080178', size: 22, font: 'Arial', color: '555555' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Indore, Madhya Pradesh, India', size: 22, font: 'Arial', color: '555555' })],
        }),

        pageBreak(),
      ],
    },

    // ── Main Content ────────────────────────────────────────────────────────
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E4057', space: 1 } },
            children: [
              new TextRun({ text: 'PropChain', bold: true, font: 'Arial', size: 18, color: '2E4057' }),
              new TextRun({ text: '  —  Confidential Product Proposal  |  Duredev Softwares', font: 'Arial', size: 18, color: '888888' }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
            children: [
              new TextRun({ text: 'Page ', font: 'Arial', size: 18, color: '888888' }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18, color: '888888' }),
              new TextRun({ text: ' of ', font: 'Arial', size: 18, color: '888888' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 18, color: '888888' }),
            ],
          })],
        }),
      },
      children: [

        // ── 1. Executive Summary ────────────────────────────────────────────
        h1('1. Executive Summary'),
        body("India's real estate sector is one of the largest in the world — and one of the most broken in how ownership, transfer, and transparency work. Buying a flat today means physical registry, opaque builder transactions, illiquid assets, and zero real-time ownership visibility. PropChain changes this."),
        spacer(),
        body('PropChain is a blockchain-powered platform built for builders and flat buyers. It digitizes the entire flat ownership lifecycle using Special Purpose Vehicles (SPVs) and blockchain tokens — so that owning a flat means holding a verifiable, transferable, and legally-anchored on-chain token that represents your SPV stake.'),
        spacer(),
        body('This proposal is built for a township project with 4 buildings and 400 total flats (this is an example for ease of understanding — in production it can have any number and can be used for multiple projects). Each building becomes a separate SPV. Flat buyers purchase SPV tokens — 1 token = 1 unit of SPV ownership. Registry is done at the SPV level. Token transfers on-chain are the legal mechanism for resale.'),
        spacer(),
        body('Duredev Softwares will design, build, and deliver this platform in 6 weeks for INR 20,00,000 — covering smart contracts, token infrastructure, SPV management portal, buyer dashboard, and compliance layer.'),

        pageBreak(),

        // ── 2. Problem Statement ────────────────────────────────────────────
        h1('2. Problem Statement: What Is Broken Today'),
        body("Real estate in India has a multi-layer problem. It is not just inefficiency — it is structural opacity baked into every layer of the transaction."),
        spacer(),

        h2('2.1 The Builder\'s Problem'),
        bullet('Managing 400 flat buyers across 4 buildings means 400 separate registry events, paperwork chains, and legal engagements.'),
        bullet('Resale of flats requires builder NOC, re-registration, and stamp duty — making transactions slow and expensive.'),
        bullet('No real-time visibility into who owns what, who has transferred, and what the current SPV ownership structure looks like.'),
        bullet('No clean mechanism to pool investors into a building without complex legal entity setup and ongoing management.'),
        spacer(),

        h2('2.2 The Flat Buyer\'s Problem'),
        bullet('Flat ownership is illiquid — once you buy, resale takes months, significant cost, and lawyer involvement.'),
        bullet('Registry documents are physical. Verifying ownership history is manual and error-prone.'),
        bullet('There is no transparent, real-time ledger showing who owns a flat and what percentage of the building\'s SPV they control.'),
        bullet('Buyers who want to transfer their ownership to a family member or new buyer have no digital mechanism — it\'s 100% paper.'),
        spacer(),

        h2('2.3 The Market Problem'),
        bullet("India's real estate tokenization is nascent. No builder-ready product exists that ties SPV ownership + flat purchase + on-chain registry."),
        bullet("SEBI's Fractional Ownership rules apply to commercial real estate. This platform is not fractional — it is full unit ownership via SPV — creating a legally distinct, cleaner structure."),
        bullet('The window to own this space is now. Builders who move first get a massive competitive edge in marketing to NRIs, HNIs, and digital-native buyers.'),

        pageBreak(),

        // ── 3. Solution ─────────────────────────────────────────────────────
        h1('3. The Solution: PropChain Platform'),
        body('PropChain is not a crypto product. It is a property management and ownership platform that uses blockchain as its backend ledger — invisible to the buyer, powerful for the system.'),
        spacer(),

        h2('3.1 Core Concept: SPV + Token = Flat Ownership'),
        body('The architecture is clean and legally grounded:'),
        spacer(),
        coreConceptTable(),
        spacer(),

        h2('3.2 Township Structure: 4 Buildings, 4 SPVs, 400 Tokens'),
        body('This is how the structure looks for the specific township project:'),
        spacer(),
        townshipStructureTable(),
        spacer(),
        body('Total across the township: 400 tokens = 400 flats = 400 SPV stakeholders across 4 registered SPVs.'),

        pageBreak(),

        // ── 4. End-to-End Flow ──────────────────────────────────────────────
        h1('4. How It Works: End-to-End Flow'),

        h2('4.1 Builder Sets Up the SPV'),
        numbered('Builder incorporates 4 SPVs (one per building) — private limited companies registered under MCA.'),
        numbered('Builder is the initial 100% stakeholder of each SPV and the original token holder.'),
        numbered('PropChain platform onboards the SPV — deploys smart contracts, creates 100 tokens per building, links flat IDs to tokens.'),
        numbered('Registry documents for all flats are executed at the SPV level — SPV is the legal owner of the building\'s flats.'),
        spacer(),

        h2('4.2 Buyer Purchases a Flat'),
        numbered('Buyer selects a flat on the PropChain platform — sees flat details, floor plan, price, and linked SPV.'),
        numbered('Buyer completes KYC on-platform (Aadhaar + PAN verification).'),
        numbered('Payment is made via the platform (UPI / bank transfer / escrow). Flat price is settled with the builder.'),
        numbered('On payment confirmation: the SPV token linked to that flat is transferred on-chain to the buyer\'s wallet address.'),
        numbered('Buyer is now a registered SPV stakeholder — their SPV % is recorded on-chain and visible in the MCA-linked dashboard.'),
        numbered('Buyer receives a digitally signed ownership certificate (NFT-backed document) from the SPV.'),
        spacer(),

        h2('4.3 Buyer Resells the Flat (Secondary Transfer)'),
        numbered('Seller lists their flat (SPV token) on the PropChain marketplace — sets price, adds details.'),
        numbered('New buyer browses listings, selects flat, completes KYC, and initiates purchase.'),
        numbered('Smart contract handles the swap atomically: payment to seller + token transfer to new buyer in one transaction.'),
        numbered('SPV cap table is updated on-chain. Old owner exits. New owner is registered as SPV stakeholder.'),
        numbered('Builder receives a platform fee (configurable) on each secondary transaction.'),

        pageBreak(),

        // ── 5. Technical Architecture ───────────────────────────────────────
        h1('5. Technical Product Architecture'),

        h2('5.1 System Overview'),
        body('PropChain is a full-stack Web3 + Web2 hybrid platform. On-chain handles the trust layer. Off-chain handles UX, KYC, payments, and documents. The combination creates a product that is legally viable, technically robust, and consumer-friendly.'),
        spacer(),

        h2('5.2 Blockchain Layer'),

        h3('5.2.1 Network Selection'),
        bullet('Primary: Polygon PoS (low gas, EVM-compatible, fast finality, SEBI-friendly for Indian regulatory conversations)'),
        bullet('Fallback / Enterprise Option: Hyperledger Besu private chain for maximum privacy and control'),
        bullet('All smart contracts are upgradeable via Proxy pattern (OpenZeppelin TransparentUpgradeableProxy)'),
        spacer(),

        h3('5.2.2 Smart Contracts'),
        body('Four primary smart contracts power the entire system:'),
        spacer(),
        smartContractsTable(),
        spacer(),

        h3('5.2.3 Token Mechanics'),
        bullet('Token supply per SPV = number of flats (e.g., 100 tokens for 100 flats)'),
        bullet('Each token is indivisible (non-fractional) — whole unit transfers only'),
        bullet('Token metadata: flat number, floor, area, SPV ID, registry reference hash'),
        bullet('Transfers are permissioned — ComplianceRegistry must whitelist both parties before transfer executes'),
        bullet('Builder wallet = initial minter and holds all tokens until primary sale'),
        spacer(),

        h2('5.3 Backend Layer'),
        bullet('Node.js + Express API server — manages business logic, KYC orchestration, payment webhooks'),
        bullet('PostgreSQL database — off-chain records for users, documents, transactions, SPV cap tables'),
        bullet('Redis — session management, real-time event caching'),
        bullet('IPFS / Pinata — storage for flat documents, ownership certificates, registry scan uploads'),
        bullet('Ethers.js / Web3.js — blockchain interaction layer'),
        bullet('RazorpayX or similar — INR payment processing, escrow management for flat purchases'),
        spacer(),

        h2('5.4 Frontend Layer'),

        h3('5.4.1 Builder Admin Portal'),
        bullet('SPV creation wizard — input building details, flat count, pricing, upload documents'),
        bullet('Token management — view minted tokens, monitor primary sales, track ownership transfers'),
        bullet('SPV cap table — real-time view of all stakeholders, their wallets, and % ownership'),
        bullet('Revenue dashboard — primary sales revenue, secondary transaction fees, pending settlements'),
        bullet('Document management — upload registry documents, link to flat tokens'),
        spacer(),

        h3('5.4.2 Buyer Dashboard'),
        bullet('Flat marketplace — browse available flats, view SPV details, pricing, and floor plans'),
        bullet('My Portfolio — view owned SPV tokens, flat details, current ownership certificate'),
        bullet('Transfer / Sell — list flat for secondary sale, set price, manage incoming offers'),
        bullet('Documents — download ownership certificate, SPV membership proof, transaction history'),
        bullet('Wallet integration — MetaMask / WalletConnect for on-chain interactions'),
        spacer(),

        h3('5.4.3 Mobile-Responsive Web App'),
        bullet('React.js frontend — mobile-first, PWA-capable'),
        bullet('No separate native app in Phase 1 — responsive web covers 95% of buyer interactions'),
        spacer(),

        h2('5.5 KYC & Compliance Module'),
        bullet('Aadhaar + PAN-based KYC via NSDL / DigiLocker API integration'),
        bullet('KYC approval triggers wallet whitelisting in ComplianceRegistry.sol'),
        bullet('Non-KYC wallets cannot receive or transfer SPV tokens — enforced at the contract level'),
        bullet('AML screening via third-party API for high-value transactions (above threshold)'),
        bullet('All KYC data stored encrypted off-chain. Only verification status stored on-chain.'),
        spacer(),

        h2('5.6 Document & Legal Layer'),
        bullet('Each SPV token links to a digitally signed ownership document stored on IPFS'),
        bullet('Document hash is anchored on-chain — tamper-proof proof of document state at time of signing'),
        bullet('Ownership certificate is auto-generated on successful token transfer (primary or secondary)'),
        bullet('SPV registry documents are uploaded by builder and linked to the SPV contract — viewable by all stakeholders'),
        bullet('Integration with DigiLocker for document vaulting (Phase 2 option)'),

        pageBreak(),

        // ── 6. Platform Modules ─────────────────────────────────────────────
        h1('6. Platform Modules: Feature Breakdown'),
        spacer(),
        platformModulesTable(),

        pageBreak(),

        // ── 7. Delivery Plan ────────────────────────────────────────────────
        h1('7. Delivery Plan: 6-Week Execution'),
        body('6 weeks. Parallel workstreams. No fluff. Here is the exact execution plan:'),
        spacer(),
        deliveryPlanTable(),

        pageBreak(),

        // ── 8. Team ─────────────────────────────────────────────────────────
        h1('8. Team & Execution Capacity'),
        body('This project will be executed by a dedicated team from Duredev Softwares. The team has delivered blockchain and AI products for clients including Uniswap, Decubate, and Solidus AI Tech.'),
        spacer(),
        teamTable(),

        pageBreak(),

        // ── 9. Commercial Proposal ──────────────────────────────────────────
        h1('9. Commercial Proposal'),

        h2('9.1 Project Investment'),
        spacer(),
        investmentTable(),
        spacer(),

        h2('9.2 Payment Terms'),
        spacer(),
        paymentTermsTable(),
        spacer(),

        h2('9.3 Post-Launch Support'),
        bullet('30 days hypercare support included — bug fixes, minor adjustments, team training'),
        bullet('Ongoing maintenance retainer available at INR 1,50,000/month (optional, covers hosting, updates, support SLA)'),
        bullet('Additional features or buildings can be added at pre-agreed rates'),

        pageBreak(),

        // ── 10. Scope Boundaries ────────────────────────────────────────────
        h1('10. Scope Boundaries'),
        body('To keep delivery clean and timeline realistic, the following are outside Phase 1 scope. They can be added in Phase 2 with separate commercial discussions.'),
        spacer(),
        h2('Out of Scope — Phase 1'),
        bullet('SEBI / RBI regulatory filings or legal advisory (builder\'s legal team handles SPV incorporation)'),
        bullet('Native mobile apps (iOS / Android) — covered via PWA in Phase 1'),
        bullet('Integration with government land registry systems (RERA, Sub-Registrar) — planned for Phase 2'),
        bullet('Multi-chain deployment (only Polygon in Phase 1)'),
        bullet('DAO governance for SPV decision-making'),
        bullet('Mortgage / loan origination integrations'),

        pageBreak(),

        // ── 11. Why Duredev ─────────────────────────────────────────────────
        h1('11. Why Duredev Softwares'),
        body('We have built blockchain infrastructure that powers real products at scale. This is not a consultancy pitch — this is a builder team that ships.'),
        spacer(),
        credentialsTable(),

        pageBreak(),

        // ── 12. Risk Register ───────────────────────────────────────────────
        h1('12. Risk Register'),
        spacer(),
        riskRegisterTable(),

        pageBreak(),

        // ── 13. Next Steps ──────────────────────────────────────────────────
        h1('13. Next Steps'),
        body('To move from proposal to build, here is what we need from the builder:'),
        spacer(),
        numbered('Sign proposal and complete engagement agreement with Duredev Softwares.'),
        numbered('Share township details — building names, flat count per building, flat pricing structure, and any existing branding.'),
        numbered('Confirm legal entity setup timeline for 4 SPVs — we can advise on the structure but the builder\'s CA handles incorporation.'),
        numbered('Make Milestone 1 payment (INR 7,00,000) to initiate project kickoff.'),
        numbered('Schedule kickoff call — we will walk through the technical architecture, collect all inputs, and kick off Sprint 1.'),
        spacer(),

        new Paragraph({
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: 'Contact Duredev Softwares', bold: true, size: 26, font: 'Arial', color: '2E4057' })],
        }),
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: 'Email: ', bold: true, size: 22, font: 'Arial' }),
            new TextRun({ text: 'Aditya.d@dure.dev', size: 22, font: 'Arial', color: '4A90D9' }),
          ],
        }),
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: 'Phone: ', bold: true, size: 22, font: 'Arial' }),
            new TextRun({ text: '+91-9130080178', size: 22, font: 'Arial' }),
          ],
        }),
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: 'Website: ', bold: true, size: 22, font: 'Arial' }),
            new TextRun({ text: 'www.dure.dev', size: 22, font: 'Arial', color: '4A90D9' }),
          ],
        }),
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: 'Location: ', bold: true, size: 22, font: 'Arial' }),
            new TextRun({ text: 'Indore, Madhya Pradesh, India', size: 22, font: 'Arial' }),
          ],
        }),

        spacer(), spacer(),

        // Legal Disclaimer
        new Paragraph({
          spacing: { before: 240, after: 120 },
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
          children: [new TextRun({ text: 'Legal Disclaimer', bold: true, size: 22, font: 'Arial', color: '555555' })],
        }),
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({
            text: 'This proposal is confidential and prepared exclusively for the recipient builder. The platform architecture described herein uses smart contracts and blockchain technology in a legally conservative structure designed to comply with applicable Indian law. PropChain does not constitute a securities offering, fractional ownership scheme under SEBI regulations, or a cryptocurrency investment product. All SPV structures must be reviewed and constituted by the builder\'s legal counsel. Duredev Softwares provides technology services only and does not provide legal, financial, or regulatory advice.',
            size: 18, font: 'Arial', color: '666666', italics: true,
          })],
        }),
        new Paragraph({
          children: [new TextRun({
            text: 'Pricing in this proposal is valid for 30 days from the document date.',
            size: 18, font: 'Arial', color: '666666', italics: true,
          })],
        }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  const outPath = '/Users/kamleshnagware/Downloads/PropChain_Proposal_Duredev.docx';
  fs.writeFileSync(outPath, buffer);
  console.log('Done:', outPath);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
