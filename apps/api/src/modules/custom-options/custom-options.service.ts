import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomOptionDto, UpdateCustomOptionDto } from './dto/create-custom-option.dto';

// System defaults per category — always shown, cannot be deleted
const SYSTEM_DEFAULTS: Record<string, { value: string; label: string; color?: string }[]> = {
  project_status: [
    { value: 'ACTIVE',     label: 'Active',     color: 'success' },
    { value: 'ON_HOLD',    label: 'On Hold',    color: 'warning' },
    { value: 'COMPLETED',  label: 'Completed',  color: 'primary' },
    { value: 'CANCELLED',  label: 'Cancelled',  color: 'danger'  },
  ],
  project_phase: [
    { value: 'PRE_DEVELOPMENT', label: 'Pre-Development', color: 'default'  },
    { value: 'PERMITTING',      label: 'Permitting',      color: 'secondary'},
    { value: 'CONSTRUCTION',    label: 'Construction',    color: 'warning'  },
    { value: 'LEASE_UP',        label: 'Lease-Up',        color: 'primary'  },
    { value: 'STABILIZED',      label: 'Stabilized',      color: 'success'  },
    { value: 'SOLD_REFI',       label: 'Sold / Refi',     color: 'success'  },
  ],
  unit_status: [
    { value: 'AVAILABLE',         label: 'Available',          color: 'success' },
    { value: 'UNDER_CONTRACT',    label: 'Under Contract',      color: 'warning' },
    { value: 'LEASED',            label: 'Leased',              color: 'primary' },
    { value: 'LEASE_PENDING',     label: 'Lease Pending',       color: 'secondary'},
    { value: 'SOLD',              label: 'Sold',                color: 'danger'  },
    { value: 'OCCUPIED',          label: 'Occupied',            color: 'primary' },
    { value: 'UNDER_CONSTRUCTION',label: 'Under Construction',  color: 'warning' },
  ],
  // Was a hardcoded UnitType Prisma enum on Unit — converted so orgs can add their own
  // unit types (e.g. "COWORKING") without a schema change.
  unit_type: [
    { value: 'RETAIL',          label: 'Retail',          color: 'primary'   },
    { value: 'MEDICAL',         label: 'Medical',         color: 'success'   },
    { value: 'FLEX',            label: 'Flex',            color: 'secondary' },
    { value: 'RESIDENTIAL_LOT', label: 'Residential Lot', color: 'primary'   },
    { value: 'COMMERCIAL_LOT',  label: 'Commercial Lot',  color: 'secondary' },
    { value: 'OFFICE',          label: 'Office',          color: 'default'   },
    { value: 'RESTAURANT',      label: 'Restaurant',      color: 'warning'   },
    { value: 'EVENT_CENTER',    label: 'Event Center',    color: 'secondary' },
  ],
  sale_status: [
    { value: 'PROSPECT',       label: 'Prospect',        color: 'default'   },
    { value: 'LOI_SIGNED',     label: 'LOI Signed',      color: 'secondary' },
    { value: 'UNDER_CONTRACT', label: 'Under Contract',  color: 'warning'   },
    { value: 'CLOSED',         label: 'Closed',          color: 'success'   },
    { value: 'CANCELLED',      label: 'Cancelled',       color: 'danger'    },
  ],
  lead_status: [
    { value: 'NEW',           label: 'New',           color: 'primary'   },
    { value: 'POTENTIAL',     label: 'Potential',     color: 'secondary' },
    { value: 'CONTACTED',     label: 'Contacted',     color: 'secondary' },
    { value: 'SITE_VISIT',    label: 'Site Visit',    color: 'warning'   },
    { value: 'QUALIFIED',     label: 'Qualified',     color: 'warning'   },
    { value: 'PROPOSAL_SENT', label: 'Proposal Sent', color: 'primary'   },
    { value: 'NEGOTIATING',   label: 'Negotiating',   color: 'warning'   },
    { value: 'CONVERTED',     label: 'Converted',     color: 'success'   },
    { value: 'LOST',          label: 'Lost',          color: 'danger'    },
    { value: 'DEAD',          label: 'Dead',          color: 'default'   },
  ],
  milestone_status: [
    { value: 'NOT_STARTED', label: 'Not Started', color: 'default'  },
    { value: 'IN_PROGRESS', label: 'In Progress', color: 'primary'  },
    { value: 'COMPLETED',   label: 'Completed',   color: 'success'  },
    { value: 'OVERDUE',     label: 'Overdue',     color: 'danger'   },
    { value: 'BLOCKED',     label: 'Blocked',     color: 'warning'  },
  ],
  lease_status: [
    { value: 'DRAFT',          label: 'Draft',          color: 'default'   },
    { value: 'ACTIVE',         label: 'Active',         color: 'success'   },
    { value: 'EXPIRED',        label: 'Expired',        color: 'warning'   },
    { value: 'TERMINATED',     label: 'Terminated',     color: 'danger'    },
    { value: 'OWNER_OCCUPIED', label: 'Owner Occupied', color: 'secondary' },
  ],
  // The client's construction board labels IN_PROGRESS "Working on it" and leaves a
  // blank cell for stuck work. Labels are theirs to change here without a deploy; the
  // stored SLUGS stay canonical so reports and filters do not have to know the wording.
  // BLOCKED added 2026-08-13 — a blank status cell is a stuck item, and without a value
  // for it people either leave the field empty or overload CANCELLED.
  task_status: [
    { value: 'TODO',        label: 'To Do',      color: 'default' },
    { value: 'IN_PROGRESS', label: 'In Progress',color: 'primary' },
    { value: 'BLOCKED',     label: 'Blocked',    color: 'danger'  },
    { value: 'DONE',        label: 'Done',       color: 'success' },
    { value: 'CANCELLED',   label: 'Cancelled',  color: 'danger'  },
  ],
  task_priority: [
    { value: 'LOW',    label: 'Low',    color: 'default'  },
    { value: 'MEDIUM', label: 'Medium', color: 'warning'  },
    { value: 'HIGH',   label: 'High',   color: 'danger'   },
    { value: 'URGENT', label: 'Urgent', color: 'danger'   },
  ],
  // Was a hardcoded BudgetCategory Prisma enum on BudgetLine/Commitment/Actual — converted
  // to this system so orgs can add their own categories. 'OTHER' must stay a system default:
  // QuickBooks sync (quickbooks.service.ts) hardcodes it for unmapped transactions.
  budget_category: [
    { value: 'LAND_ACQUISITION', label: 'Land Acquisition', color: 'secondary' },
    { value: 'SITE_WORK',        label: 'Site Work',        color: 'warning'   },
    { value: 'HARD_COSTS',       label: 'Hard Costs',       color: 'primary'   },
    { value: 'SOFT_COSTS',       label: 'Soft Costs',       color: 'primary'   },
    { value: 'FINANCING',        label: 'Financing',        color: 'secondary' },
    { value: 'PERMITS_FEES',     label: 'Permits & Fees',   color: 'warning'   },
    { value: 'CONTINGENCY',      label: 'Contingency',      color: 'danger'    },
    { value: 'MARKETING',        label: 'Marketing',        color: 'success'   },
    { value: 'LEGAL',            label: 'Legal',            color: 'secondary' },
    { value: 'OTHER',            label: 'Other',            color: 'default'   },
  ],
  // Was a hardcoded LoanType Prisma enum on Loan — converted so orgs can add their own
  // loan types (e.g. "SBA 504") without a schema change.
  loan_type: [
    { value: 'CONSTRUCTION', label: 'Construction', color: 'warning'   },
    { value: 'PERMANENT',    label: 'Permanent',    color: 'primary'   },
    { value: 'BRIDGE',       label: 'Bridge',       color: 'secondary' },
    { value: 'MEZZANINE',    label: 'Mezzanine',    color: 'danger'    },
    { value: 'SBA',          label: 'SBA',          color: 'success'   },
  ],
  // Unit Construction Checklist (2026-08-21) — separate from task_status because the
  // client's board uses this exact wording ("Not Started" / "Working on it"), and the
  // checklist and the Task board are relabeled independently by design.
  construction_stage_status: [
    { value: 'NOT_STARTED', label: 'Not Started',  color: 'default' },
    { value: 'IN_PROGRESS', label: 'Working on it', color: 'warning' },
    { value: 'BLOCKED',     label: 'Blocked',       color: 'danger'  },
    { value: 'DONE',        label: 'Done',          color: 'success' },
  ],
  // No longer assumed. The 2026-08-26 audit of the client's live monday board read this
  // column's stored label set directly: six values, of which only "Passed" has ever been
  // used (3 of 540 rows). NOT_STARTED is renamed to the board's own NOT_INSPECTED, and the
  // two states it was missing — IN_PROGRESS and REQUIRES_FOLLOW_UP — are added.
  //
  // Colours are deliberately NOT ported. On the board, Failed renders brown and Requires
  // Follow-up renders dark green, both calmer than In Progress in red — unadjusted template
  // defaults that make a failed inspection look less urgent than one merely underway.
  construction_inspection_status: [
    { value: 'NOT_INSPECTED',       label: 'Not Inspected',       color: 'default'   },
    { value: 'SCHEDULED',           label: 'Scheduled',            color: 'primary'   },
    { value: 'IN_PROGRESS',         label: 'In Progress',          color: 'secondary' },
    { value: 'PASSED',              label: 'Passed',               color: 'success'   },
    { value: 'FAILED',              label: 'Failed',               color: 'danger'    },
    { value: 'REQUIRES_FOLLOW_UP',  label: 'Requires Follow-up',   color: 'warning'   },
  ],
  // ── Site Tracker (Phase 1) ────────────────────────────────────────────────
  // LOW/MEDIUM/HIGH only. The source board's PRIORITY column also carries a "DONE" label,
  // which is a completion state living in a priority scale; worse, its "done" colour is set
  // to LOW, so its own group battery reports LOW items as finished. Completion here is the
  // checklist percentage, and the two concepts stay apart.
  site_priority: [
    { value: 'LOW',    label: 'Low',    color: 'primary' },
    { value: 'MEDIUM', label: 'Medium', color: 'warning' },
    { value: 'HIGH',   label: 'High',   color: 'danger'  },
  ],
  // Deliberately EMPTY, and deliberately present.
  //
  // Present so the category is discoverable — findAllCategories() reads these keys, so
  // registering it here is what puts "Construction Stage" in Admin -> Options even on a
  // database where nobody has added one yet.
  //
  // Empty because system defaults are frozen: they are synthesised on read with `sys_`
  // ids, so update() cannot find them and remove() refuses them — they can never be
  // renamed, reordered or retired. Stage names are the client's own vocabulary and the
  // sequence is theirs to change, so the eighteen ship as ordinary rows from the
  // 20260902000000_construction_stage_catalogue migration instead.
  construction_stage: [],
};

@Injectable()
export class CustomOptionsService {
  constructor(private prisma: PrismaService) {}

  async findByCategory(category: string) {
    const systemDefaults = (SYSTEM_DEFAULTS[category] || []).map((d, idx) => ({
      id: `sys_${category}_${d.value}`,
      category,
      value:     d.value,
      label:     d.label,
      color:     d.color ?? null,
      sortOrder: idx,
      isSystem:  true,
      isActive:  true,
      createdById: 'system',
      createdAt:   new Date(0).toISOString(),
      updatedAt:   new Date(0).toISOString(),
    }));

    const custom = await this.prisma.customOption.findMany({
      where: { category, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return [...systemDefaults, ...custom];
  }

  async findAllCategories() {
    const systemCats = Object.keys(SYSTEM_DEFAULTS);
    const customCats = await this.prisma.customOption.findMany({
      where: { isActive: true },
      select: { category: true },
      distinct: ['category'],
    });
    const all = new Set([...systemCats, ...customCats.map((c) => c.category)]);
    return Array.from(all).sort();
  }

  async create(data: CreateCustomOptionDto & { createdById: string }) {
    return this.prisma.customOption.create({ data });
  }

  async update(id: string, data: UpdateCustomOptionDto) {
    const opt = await this.prisma.customOption.findUnique({ where: { id } });
    if (!opt) throw new NotFoundException('Custom option not found');

    const updated = await this.prisma.customOption.update({ where: { id }, data });

    // Renaming a construction stage has to reach the rows that use it.
    //
    // UnitConstructionStage stores `stageValue` as the identity and `label` as a mirror,
    // because the rollup, the Site Tracker grid, the daily-log joins and the exports all
    // read `label` — mirroring it is one UPDATE here instead of a join in every one of
    // them. The mirror is only true if a rename re-syncs it, which is this.
    //
    // Building templates carry the same name for the same reason.
    if (opt.category === 'construction_stage' && data.label && data.label !== opt.label) {
      await this.prisma.$transaction([
        this.prisma.unitConstructionStage.updateMany({
          where: { stageValue: opt.value },
          data: { label: data.label },
        }),
        this.prisma.constructionStageTemplateItem.updateMany({
          where: { label: opt.label },
          data: { label: data.label },
        }),
      ]);
    }

    return updated;
  }

  /**
   * Put one category's options in the given order, in a single transaction.
   *
   * Takes every option in the category exactly once. A partial list would have to invent
   * positions for the rest, and a two-row swap — the obvious alternative — is worse: it is
   * two writes, and between them both rows carry the same sortOrder, so the list re-sorts
   * under whoever is clicking and a quick second click acts on indices that have moved.
   *
   * One pass is enough here. sortOrder carries no unique constraint on custom_options, so
   * rows can pass through each other without colliding — unlike unit_construction_stages,
   * which needs the two-pass negative shuffle.
   */
  async reorder(category: string, ids: string[]) {
    const existing = await this.prisma.customOption.findMany({
      where: { category, isActive: true },
      select: { id: true },
    });
    const known = new Set(existing.map((o) => o.id));
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new BadRequestException('The same option was listed more than once.');
    }
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new BadRequestException(
        'Send every option in this category exactly once — a partial order would have to '
        + 'invent positions for the rest.',
      );
    }

    await this.prisma.$transaction(
      ids.map((id, i) => this.prisma.customOption.update({ where: { id }, data: { sortOrder: i } })),
    );
    return this.findByCategory(category);
  }

  async remove(id: string) {
    const opt = await this.prisma.customOption.findUnique({ where: { id } });
    if (!opt) throw new NotFoundException('Custom option not found');
    if (opt.isSystem) throw new ForbiddenException('System options cannot be deleted');
    // soft-delete
    return this.prisma.customOption.update({ where: { id }, data: { isActive: false } });
  }

  getSystemDefaults() {
    return SYSTEM_DEFAULTS;
  }
}
