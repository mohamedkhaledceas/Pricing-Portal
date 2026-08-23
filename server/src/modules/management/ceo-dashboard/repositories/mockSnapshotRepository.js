/* Placeholder data source — NOT a real integration. Ported verbatim from
   the CEO dashboard design-review prototype (ceas-ceo-dashboard.html,
   supplied 2026-08-09). Every figure below was invented for design review
   — a plausible mid-size Cairo agency, not Ceas Comm's real numbers — and
   is not connected to Odoo or ClickUp. See the "Prototype with mocked
   data" banner in views/index.html, which stays up as long as this file
   is the data source.

   This is the intended swap point: once there is an Odoo account (and,
   per the user, possibly ClickUp for parts of this), replace this file
   with a real repository that queries those systems, keep the same
   getShell/getEntityKeys/getEntitySnapshot/getBrief shape, and nothing
   above this layer (service/controller/frontend) needs to change. Trigger:
   Odoo credentials exist and the user has specified which field comes from
   where — no ADR yet because that mapping isn't decided.

   The 'lwm' (Learn with Marie) and 'all' (Consolidated) entities are kept
   only because the prototype's entity switcher was kept faithfully (see
   implementation plan) — Learn with Marie is not a real, integrated
   business entity anywhere else in this codebase, and CLAUDE.md documents
   this portal as single-company. Both stay permanently on this mock
   repository until/unless that changes. */

const DATA = {
  asOf: '2026-08-09',
  asOfLabel: 'Sunday, 9 August 2026 · 08:00 Africa/Cairo',
  currency: 'EGP',
  syncStatus: [
    { source: 'Odoo Online', lastSync: '09 Aug 2026, 06:14', status: 'ok', note: 'Incremental · 412 records' },
    { source: 'ClickUp', lastSync: '09 Aug 2026, 06:22', status: 'ok', note: 'Webhooks + catch-up · 1,864 tasks' },
  ],
  entities: {
    ceas: {
      name: 'Ceas Comm',
      health: {
        score: 62, prior7: 66, prior30: 69,
        components: [
          { name: 'Financial', weight: 25, score: 68, note: 'Revenue at 98.8% of target, but margin down 4 months running' },
          { name: 'Collections', weight: 20, score: 52, note: 'DSO 68 days; a quarter of receivables past 60 days' },
          { name: 'Pipeline', weight: 15, score: 61, note: 'Weighted coverage 1.40x against a 2.0x floor' },
          { name: 'Delivery', weight: 20, score: 64, note: 'On-time 82.4%; 4 projects red' },
          { name: 'People', weight: 10, score: 71, note: 'Utilisation healthy; attrition 18.2% and 4 roles open' },
          { name: 'Strategic', weight: 10, score: 58, note: '1 of 5 initiatives red, 3 amber' },
        ],
        series: [73, 72, 72, 71, 71, 70, 70, 70, 69, 68, 67, 66, 62],
        labels: ['-12w', '-11w', '-10w', '-9w', '-8w', '-7w', '-6w', '-5w', '-4w', '-3w', '-2w', '-1w', 'Now'],
      },
      revenue: {
        ytd: 50400000, ytdTarget: 51032258, ytdPct: 98.8, mtd: 1980000, mtdTarget: 2032258,
        months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
        actual: [6240000, 6580000, 7410000, 6890000, 7720000, 7150000, 6430000, 1980000],
        target: [7000000, 7000000, 7000000, 7000000, 7000000, 7000000, 7000000, 2032258],
        targetFull: 7000000, margin: 41.2, marginTarget: 44.8,
        marginSeries: [45.8, 45.1, 46.2, 44.9, 44.1, 43.5, 41.2], marginPrior: 43.5, marginDeclineRun: 4,
        serviceLines: [
          { name: 'Performance / Media Buying', value: 12340000 },
          { name: 'Brand Communication', value: 10180000 },
          { name: 'Content & Social Retainers', value: 9650000 },
          { name: 'Media Production', value: 7420000 },
          { name: 'PR Campaigns', value: 4880000 },
          { name: 'Activations & Events', value: 3210000 },
          { name: 'Web & Digital', value: 1860000 },
          { name: 'Printing', value: 860000 },
        ],
        mix: [{ name: 'Retainer', value: 31250000 }, { name: 'Project', value: 19150000 }],
        passthrough: 18600000, bookedForward: 19400000, revPerHead: 1527273, agencyHeadcount: 33,
        clients: [
          { name: 'Nile Bank', value: 5640000, type: 'Retainer', am: 'Hana Ismail', status: 'active', overdue: 0 },
          { name: 'Cairo Grand Developments', value: 2780000, type: 'Project', am: 'Nour Adel', status: 'active', overdue: 1840000 },
          { name: 'Delta Foods', value: 1960000, type: 'Retainer', am: 'Engy Sameh', status: 'active', overdue: 0 },
          { name: 'Horizon Telecom', value: 1720000, type: 'Retainer', am: 'El Shewy', status: 'active', overdue: 0 },
          { name: 'Mansour Auto', value: 1410000, type: 'Retainer', am: 'Monica George', status: 'renewal', overdue: 262000 },
          { name: 'Zamalek Hospitality Group', value: 1180000, type: 'Project', am: 'Yasser Tulba', status: 'active', overdue: 920000 },
          { name: 'Sphinx Pharma', value: 980000, type: 'Retainer', am: 'Monica Emad', status: 'active', overdue: 295000 },
          { name: 'Nefertari Cosmetics', value: 870000, type: 'Project', am: 'Engy Sameh', status: 'active', overdue: 0 },
          { name: 'Alexandria Marine', value: 720000, type: 'Project', am: 'Monica George', status: 'active', overdue: 610000 },
          { name: 'Cleo Retail', value: 640000, type: 'Retainer', am: 'Nour Adel', status: 'active', overdue: 340000 },
          { name: 'Other (12 clients)', value: 2680000, type: 'Mixed', am: '—', status: 'active', overdue: 0 },
        ],
        trailing90: 20580000, concentration: 27.4,
      },
      pipeline: {
        total: 31400000, weighted: 11720000, count: 18, q4Target: 8400000, coverage: 1.4, coverageFloor: 2.0,
        winRate: 31, winRatePrior: 38, cycleDays: 47, cycleDaysPrior: 41, stalledCount: 5, stalledValue: 6900000,
        stages: [
          { name: 'New', count: 6, value: 8900000, prob: 10 },
          { name: 'Qualified', count: 5, value: 9600000, prob: 30 },
          { name: 'Proposal', count: 4, value: 7800000, prob: 50 },
          { name: 'Negotiation', count: 2, value: 3600000, prob: 75 },
          { name: 'Verbal commit', count: 1, value: 1500000, prob: 90 },
        ],
        deals: [
          { name: 'Suez Logistics — brand system', value: 1500000, stage: 'Verbal commit', close: '20 Aug 2026', prob: 90, owner: 'Hana Ismail' },
          { name: 'Horizon Telecom — retainer expansion', value: 2400000, stage: 'Negotiation', close: '28 Aug 2026', prob: 75, owner: 'El Shewy' },
          { name: 'Delta Foods — Ramadan 2027 campaign', value: 3600000, stage: 'Proposal', close: '15 Sep 2026', prob: 50, owner: 'Engy Sameh' },
          { name: 'Sphinx Pharma — PR retainer', value: 1200000, stage: 'Qualified', close: '30 Sep 2026', prob: 30, owner: 'Monica Emad' },
        ],
        lostReasons: [
          { name: 'Price', pct: 42 }, { name: 'Timing', pct: 24 },
          { name: 'Lost to competitor', pct: 19 }, { name: 'No decision', pct: 15 },
        ],
      },
      collections: {
        receivables: 14860000,
        aging: [
          { name: '0–30 days', value: 7240000 }, { name: '31–60 days', value: 3910000 },
          { name: '61–90 days', value: 2180000 }, { name: '90+ days', value: 1530000 },
        ],
        overdue60plus: 3710000, overdue60pct: 25.0, dso: 68, dsoPrior: 66, dsoTarget: 55,
        dsoSeries: [58, 57, 59, 61, 60, 62, 61, 63, 64, 62, 66, 68],
        dsoLabels: ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
        collectionRate: 71, collectionRateTarget: 85,
        detail: [
          { name: 'Cairo Grand Developments', value: 1840000, days: 74, am: 'Nour Adel', activeProjects: 3 },
          { name: 'Zamalek Hospitality Group', value: 920000, days: 96, am: 'Yasser Tulba', activeProjects: 1 },
          { name: 'Alexandria Marine', value: 610000, days: 68, am: 'Monica George', activeProjects: 2 },
          { name: 'Cleo Retail', value: 340000, days: 63, am: 'Nour Adel', activeProjects: 1 },
          { name: 'Sphinx Pharma', value: 295000, days: 47, am: 'Monica Emad', activeProjects: 2 },
          { name: 'Mansour Auto', value: 262000, days: 38, am: 'Monica George', activeProjects: 1 },
        ],
      },
      delivery: {
        onTime: 82.4, onTimePrior: 83.9, onTimeFloor: 85.0,
        onTimeSeries: [91.2, 90.4, 89.8, 90.6, 88.9, 89.4, 87.6, 88.2, 86.1, 85.4, 83.9, 82.4],
        onTimeLabels: ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
        rag: { green: 21, amber: 9, red: 4 }, activeProjects: 34,
        projects: [
          { name: 'Nile Bank — Q4 Brand Campaign', line: 'Media Production', owner: 'Mohamed Khalid', issue: '9 days behind schedule', rag: 'red' },
          { name: 'Cairo Grand — Launch Activation', line: 'Activations', owner: 'Nour Adel', issue: 'Blocked on client approval, 12 days', rag: 'red' },
          { name: 'Delta Foods — Ramadan Content Engine', line: 'Content', owner: 'Engy Sameh', issue: '71% of hours used at 48% complete', rag: 'red' },
          { name: 'Horizon Telecom — Website Rebuild', line: 'Web & Digital', owner: 'El Shewy', issue: 'Vendor dependency, 14 days late', rag: 'red' },
          { name: 'Nefertari — Q3 Social Retainer', line: 'Content', owner: 'Annasimon Amir', issue: '3 deliverables slipped this week', rag: 'amber' },
          { name: 'Sphinx Pharma — Corporate Film', line: 'Media Production', owner: 'Mariana Albert', issue: 'Shoot day moved twice', rag: 'amber' },
        ],
        overdue_tasks: 147, overdue_tasks_prior_week: 118, stuck_in_review: 23, scope_creep_projects: 6,
        unbilled_projects: 3, unbilled_value: 1240000,
      },
      people: {
        headcount: 36, headcount_jan: 34, utilisation: 78.4, utilisation_target: 75.0,
        attrition_12m: 18.2, leavers_12m: 6, active_offboardings: 2, timeoff_next14: 6,
        openRoles: [
          { role: 'Sales Lead', days: 68, stage: 'Offer stage', note: 'Blocks Sales Team Building' },
          { role: 'Senior Performance Marketer', days: 52, stage: 'Interviewing', note: 'Performance team at 88% utilisation' },
          { role: 'Account Manager', days: 23, stage: 'Screening', note: '—' },
          { role: 'Video Editor', days: 11, stage: 'Sourcing', note: '—' },
        ],
        onboarding: [
          { name: 'Mariana Albert', milestone: '30-day', days: -8 },
          { name: 'Monica Emad', milestone: '60-day', days: 5 },
          { name: 'Annasimon Amir', milestone: '30-day', days: 12 },
          { name: 'El Shewy', milestone: '90-day', days: 19 },
          { name: 'Shreen', milestone: '60-day', days: 22 },
        ],
        overload: { name: 'Nour Adel', tasks: 31, clients: 4 },
        utilTeams: [
          { name: 'Design', value: 91.2 }, { name: 'Performance', value: 88.3 }, { name: 'Content', value: 84.6 },
          { name: 'Accounts', value: 79.5 }, { name: 'Production', value: 72.1 }, { name: 'PR', value: 64.8 }, { name: 'Web', value: 58.2 },
        ],
        utilTarget: 75.0,
        headcountSeries: [34, 34, 35, 35, 36, 37, 37, 36, 36, 36, 36, 36],
        headcountLabels: ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
      },
      strategic: {
        items: [
          { name: 'Ceas Comm Repositioning & Brand System', owner: 'Marie Haddad', pct: 64, next: 'Website copy sign-off — 22 Aug', idle: 3, rag: 'amber' },
          { name: 'People & Culture System 2026', owner: 'Shreen', pct: 71, next: 'Performance review cycle — 1 Sep', idle: 1, rag: 'green' },
          { name: 'Performance Function Building 2026', owner: 'Yasser Tulba', pct: 55, next: 'Media buying SOP rollout — 30 Aug', idle: 6, rag: 'amber' },
          { name: 'Growth Initiative 2026', owner: 'Marie Haddad', pct: 42, next: 'GCC market study — 15 Sep', idle: 9, rag: 'amber' },
          { name: 'Sales Team Building', owner: 'Marie Haddad', pct: 38, next: 'Sales Lead hire — overdue', idle: 24, rag: 'red' },
        ],
        paused: [{ name: 'GCC Expansion Plan', days: 118 }, { name: 'Performance Marketing Dept — Creation', days: 64 }],
      },
      risks: [
        { severity: 'critical', category: 'Revenue', title: 'Client concentration — Nile Bank', detail: 'Nile Bank is 27.4% of trailing-90-day revenue, above the 25% threshold.', value: '27.4% vs 25.0%', since: '2026-08-04', owner: 'Marie Haddad' },
        { severity: 'critical', category: 'Collections', title: 'Delivering to a debtor — Cairo Grand', detail: 'EGP 1.84M is 74 days overdue while 3 projects continue in active delivery.', value: 'EGP 1,840,000 · 74 days', since: '2026-08-06', owner: 'Nour Adel' },
        { severity: 'serious', category: 'Revenue', title: 'Gross margin slide', detail: 'Gross margin 41.2% in July against a 44.8% target — a fourth consecutive monthly decline.', value: '41.2% vs 44.8%', since: '2026-07-31', owner: 'Finance' },
        { severity: 'serious', category: 'Delivery', title: 'On-time delivery below floor', detail: 'Rolling 30-day on-time delivery is 82.4%, under the 85% floor for 3 weeks.', value: '82.4% vs 85.0%', since: '2026-07-19', owner: 'Yasser Tulba' },
        { severity: 'serious', category: 'Strategic', title: 'Strategic initiative stalled', detail: 'Sales Team Building has had no recorded activity for 24 days.', value: '24 days idle', since: '2026-08-01', owner: 'Marie Haddad' },
        { severity: 'serious', category: 'People', title: 'Key person overload', detail: 'Nour Adel is carrying 31 overdue tasks across 4 client accounts.', value: '31 overdue tasks', since: '2026-08-05', owner: 'Shreen' },
        { severity: 'warning', category: 'Pipeline', title: 'Pipeline coverage thin for Q4', detail: 'Weighted pipeline is 1.40x the Q4 new-business target against a 2.0x floor.', value: '1.40x vs 2.00x', since: '2026-07-28', owner: 'Hana Ismail' },
        { severity: 'warning', category: 'Revenue', title: 'Retainer at risk — Mansour Auto', detail: 'Contract ends 30 Sep with no renewal opportunity in the pipeline.', value: 'EGP 1.41M annualised · 52 days', since: '2026-08-08', owner: 'Monica George' },
        { severity: 'warning', category: 'Collections', title: 'Aged receivable — Zamalek Hospitality', detail: 'EGP 920,000 has passed 96 days outstanding.', value: 'EGP 920,000 · 96 days', since: '2026-07-22', owner: 'Yasser Tulba' },
        { severity: 'warning', category: 'Delivery', title: 'Delivered but unbilled', detail: '3 projects marked complete in ClickUp have no Odoo invoice after 15 days.', value: 'EGP 1,240,000', since: '2026-08-07', owner: 'Finance' },
        { severity: 'warning', category: 'People', title: 'Attrition signal', detail: 'Two offboardings in progress within 30 days (Content Creator, Traffic Manager).', value: '2 departures', since: '2026-08-03', owner: 'Shreen' },
      ],
      actions: [
        { kind: 'decide', urgency: 'critical', title: 'Cairo Grand — continue delivery or pause pending payment', why: 'EGP 1.84M is 74 days overdue and three projects are still consuming delivery capacity. Every week of continued work increases exposure.', suggested: 'Pause new work, keep committed deliverables, and escalate to their CFO this week.', due: 'Today', block: 'Collections' },
        { kind: 'approve', urgency: 'serious', title: 'Hiring requisition — Sales Lead, re-open at higher band', why: 'Pending 11 days. The role has been open 68 days and is the single blocker on the Sales Team Building initiative, which is now 24 days idle.', suggested: 'Approve the higher band or formally deprioritise the initiative.', due: '2 days', block: 'People' },
        { kind: 'decide', urgency: 'serious', title: 'Mansour Auto renewal — contract ends 30 Sep', why: 'EGP 1.41M annualised retainer with no renewal opportunity created. 52 days to expiry.', suggested: 'Assign an owner and open a renewal opportunity in Odoo this week.', due: '5 days', block: 'Revenue' },
        { kind: 'approve', urgency: 'warning', title: 'Quote above your threshold — Delta Foods Ramadan 2027', why: 'EGP 3.6M proposal awaiting CEO sign-off before it goes out. Expected close 15 Sep.', suggested: 'Review pricing against the margin floor, then approve.', due: '3 days', block: 'Pipeline' },
        { kind: 'review', urgency: 'serious', title: 'Nile Bank — Q4 campaign 9 days behind', why: 'Your largest account, 27.4% of revenue, with a client escalation flagged on the project thread.', suggested: 'Call the client lead before Tuesday’s status meeting.', due: 'Today', block: 'Delivery' },
        { kind: 'approve', urgency: 'warning', title: 'Supplier expense — studio rental, Nile Bank shoot', why: 'EGP 145,000, pending 3 days. Shoot day is booked for 18 Aug.', suggested: 'Approve or the booking lapses.', due: '2 days', block: 'Operations' },
        { kind: 'approve', urgency: 'warning', title: 'Tool budget — Figma Enterprise upgrade', why: 'EGP 84,000/year, requested by Hana Ismail, pending 6 days.', suggested: 'Approve, defer to Q4, or decline.', due: '7 days', block: 'Operations' },
      ],
    },
    lwm: {
      name: 'Learn with Marie',
      health: {
        score: 61, prior7: 60, prior30: 63,
        components: [
          { name: 'Financial', weight: 25, score: 54, note: 'YTD revenue 78.5% of target' },
          { name: 'Collections', weight: 20, score: 82, note: 'EGP 180K outstanding, none past 30 days' },
          { name: 'Pipeline', weight: 15, score: 61, note: '1,840 leads converting to paid at 1.5%' },
          { name: 'Delivery', weight: 20, score: 49, note: 'Content engine 18 of 24 pieces published this month' },
          { name: 'People', weight: 10, score: 66, note: '3 people carrying a launch 62 days out' },
          { name: 'Strategic', weight: 10, score: 55, note: 'Launch #1 at 41% with 62 days remaining' },
        ],
        series: [67, 66, 66, 65, 65, 64, 64, 64, 63, 62, 61, 60, 61],
        labels: ['-12w', '-11w', '-10w', '-9w', '-8w', '-7w', '-6w', '-5w', '-4w', '-3w', '-2w', '-1w', 'Now'],
      },
      revenue: {
        ytd: 4120000, ytdTarget: 5249032, ytdPct: 78.5, mtd: 326000, mtdTarget: 209032,
        months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
        actual: [410000, 465000, 520000, 486000, 604000, 571000, 738000, 326000],
        target: [720000, 720000, 720000, 720000, 720000, 720000, 720000, 209032],
        targetFull: 720000,
        serviceLines: [
          { name: 'Cohort programmes', value: 2130000 }, { name: '1:1 consulting', value: 986000 },
          { name: 'Digital products', value: 664000 }, { name: 'Speaking & workshops', value: 340000 },
        ],
        funnel: [
          { name: 'Leads captured', value: 1840 }, { name: 'Qualified', value: 214 },
          { name: 'Consultation booked', value: 62 }, { name: 'Consultation held', value: 41 }, { name: 'Converted', value: 27 },
        ],
        leads_total: 1840, leads_qualified: 214, consults_booked: 62, consults_held: 41, converted: 27,
        conversion: 1.5, qualRate: 11.6, receivables: 180000, headcount: 3,
        launch_pct: 41, launch_days: 62, content_published: 18, content_planned: 24,
      },
      risks: [
        { severity: 'serious', category: 'Delivery', title: 'Content engine behind plan', detail: '18 of 24 planned pieces published this month with Launch #1 only 62 days out.', value: '18 of 24 pieces', since: '2026-08-05', owner: 'Marie Haddad' },
        { severity: 'warning', category: 'Strategic', title: 'Launch #1 milestone risk', detail: 'Launch is 41% complete with 62 days remaining; sales page and email sequence not started.', value: '41% at 62 days', since: '2026-08-02', owner: 'Marie Haddad' },
        { severity: 'warning', category: 'Revenue', title: 'YTD revenue behind target', detail: 'EGP 4.12M against a 5.25M year-to-date target.', value: '78.5% of target', since: '2026-07-31', owner: 'Marie Haddad' },
      ],
      actions: [
        { kind: 'decide', urgency: 'serious', title: 'Launch #1 — confirm scope or move the date', why: '41% complete at 62 days out, with the sales page and email sequence not started and one content person shared with the agency.', suggested: 'Cut the bonus module or push the launch to November. Decide this week.', due: '5 days', block: 'Strategic' },
        { kind: 'approve', urgency: 'warning', title: 'Cohort pricing for Launch #1', why: 'Pricing tiers need sign-off before the sales page can be written.', suggested: 'Approve the three-tier structure or send back with a target price.', due: '7 days', block: 'Revenue' },
      ],
    },
    all: {
      name: 'Consolidated',
      revenue: {
        ytd: 54520000, ytdTarget: 56281290, ytdPct: 96.9,
        months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
        actual: [6650000, 7045000, 7930000, 7376000, 8324000, 7721000, 7168000, 2306000],
        target: [7720000, 7720000, 7720000, 7720000, 7720000, 7720000, 7720000, 2241290],
        mtd: 2306000, mtdTarget: 2241290,
      },
      health: { score: 62, prior7: 66, prior30: 69 },
    },
  },
};

const BRIEFS = {
  ceas: {
    date: 'Sunday, 9 August 2026',
    headline: 'Revenue is holding within 1.2% of target, but margin, collections and delivery are all drifting the same way — and your largest account has crossed the concentration threshold.',
    sections: [
      { title: 'What changed', items: [
        'Company health fell to <b>62</b>, down 4 points in a week and 7 in a month. Collections and delivery drove most of the drop.',
        '<b>Nile Bank</b> crossed the concentration threshold on 4 August — now <b>27.4%</b> of trailing-90-day revenue against a 25% limit.',
        '<b>Cairo Grand</b> passed 74 days overdue on <b>EGP 1,840,000</b> while three of their projects stayed in active delivery.',
        'Overdue tasks rose to <b>147</b> from 118 last week — the sharpest weekly jump this quarter.',
        '<b>Mansour Auto’s</b> renewal window opened yesterday: the contract ends 30 September with no renewal opportunity in Odoo.',
      ] },
      { title: 'What’s concerning', items: [
        '<b>Gross margin was 41.2% in July</b> — a fourth consecutive monthly decline, 3.6 points under target. Against year-to-date revenue that gap is roughly <b>EGP 1.8M</b> of margin not earned.',
        '<b>DSO is 68 days</b> versus a 55-day target — its worst reading in twelve months. A quarter of the EGP 14.86M book, <b>EGP 3.71M</b>, is past 60 days.',
        '<b>On-time delivery is 82.4%</b>, under the 85% floor for three weeks, with four projects red. One of them is Nile Bank’s Q4 campaign.',
        'Q4 new business has <b>1.40× coverage</b> against a 2.0× floor, and win rate has slipped to 31% from 38%.',
        'These are not independent problems. Nile Bank, Cairo Grand and Zamalek together are <b>46.6%</b> of trailing-90-day revenue, and all three appear in this morning’s risk register.',
      ] },
      { title: 'What needs your attention today', items: [
        '<b>Cairo Grand — decide whether delivery continues.</b> Every further week of work adds exposure to EGP 1.84M that is already 74 days late.',
        '<b>Nile Bank’s Q4 campaign is 9 days behind</b> with a client escalation on the thread. That account is 27.4% of revenue; a call before Tuesday’s status meeting is cheap insurance.',
        '<b>The Sales Lead requisition has been with you 11 days.</b> The role has been open 68 days and Sales Team Building — blocked on it — has been idle for 24.',
      ] },
      { title: 'Quiet good news', items: [
        '<b>People &amp; Culture System 2026</b> reached 71% and moved yesterday — the only strategic initiative currently green.',
        '<b>EGP 19.4M</b> of forward revenue is already booked on signed contracts for the next three months.',
        '<b>Learn with Marie posted its best month yet in July</b> at EGP 738,000, 2.5% above its monthly target.',
        'Both sources synced cleanly this morning, so nothing here is running on stale figures.',
      ] },
    ],
  },
  lwm: {
    date: 'Sunday, 9 August 2026',
    headline: 'Revenue is 21.5% behind the year-to-date plan and Launch #1 is 41% built with 62 days left — the launch is effectively the whole quarter.',
    sections: [
      { title: 'What changed', items: [
        'July was the strongest month on record at <b>EGP 738,000</b>, 2.5% ahead of the monthly target and the first month above plan this year.',
        'Content published this month stands at <b>18 of 24</b> planned pieces.',
        'Launch #1 readiness moved to <b>41%</b> with 62 days remaining.',
      ] },
      { title: 'What’s concerning', items: [
        'Year-to-date revenue is <b>EGP 4.12M</b> against a <b>EGP 5.25M</b> plan — <b>78.5%</b>. One strong month has not closed the gap.',
        'The funnel leaks hardest between qualified and booked: <b>214 qualified</b> leads produced <b>62</b> consultations, a 29.0% conversion.',
        '<b>Three people</b> are carrying the launch, and the content lead is shared with the agency side where utilisation is already 84.6%.',
      ] },
      { title: 'What needs your attention today', items: [
        '<b>Confirm the Launch #1 scope or move the date.</b> At 41%, with the sales page and email sequence not started, 62 days is tight.',
        '<b>Cohort pricing needs sign-off</b> before the sales page can be written — it is the first domino in the sequence.',
      ] },
      { title: 'Quiet good news', items: [
        'Receivables are <b>EGP 180,000</b> with nothing past 30 days — cohort fees are collecting up front, as designed.',
        '<b>1,840 leads</b> year to date means the volume is there. The constraint is conversion, which is fixable without more spend.',
      ] },
    ],
  },
  all: {
    date: 'Sunday, 9 August 2026',
    headline: 'Consolidated revenue is EGP 54.52M, 96.9% of the year-to-date plan — the agency is carrying its shortfall better than the education line.',
    sections: [
      { title: 'What changed', items: [
        'Consolidated year-to-date revenue is <b>EGP 54.52M</b> against a <b>EGP 56.28M</b> plan — <b>96.9%</b>.',
        'Ceas Comm is at <b>98.8%</b> of plan; Learn with Marie at <b>78.5%</b>.',
        'Revenue-weighted company health is <b>62</b>, down from 66 a week ago.',
      ] },
      { title: 'What’s concerning', items: [
        'The two entities are behind for different reasons — the agency on margin and collections, the education line on top-line volume. They do not offset each other.',
        'Learn with Marie is <b>EGP 1.13M</b> behind plan year to date; the agency is <b>EGP 632,000</b> behind.',
      ] },
      { title: 'What needs your attention today', items: [
        'Both entity queues have open decisions. Switch views for the detail — this roll-up deliberately carries numbers only, so nothing gets decided from an average.',
      ] },
      { title: 'Quiet good news', items: [
        'August month-to-date is <b>EGP 2.31M</b> across 9 days, running 2.9% ahead of the same-period plan.',
      ] },
    ],
  },
};

const ENTITY_KEYS = Object.keys(DATA.entities);

function getShell() {
  return { asOf: DATA.asOf, asOfLabel: DATA.asOfLabel, currency: DATA.currency, syncStatus: DATA.syncStatus };
}

function getEntityKeys() {
  return ENTITY_KEYS;
}

function getEntitySnapshot(entityKey) {
  return DATA.entities[entityKey] || null;
}

function getBrief(entityKey) {
  return BRIEFS[entityKey] || null;
}

module.exports = { getShell, getEntityKeys, getEntitySnapshot, getBrief };
