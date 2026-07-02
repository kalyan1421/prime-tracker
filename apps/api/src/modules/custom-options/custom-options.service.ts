import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
  task_status: [
    { value: 'TODO',        label: 'To Do',      color: 'default' },
    { value: 'IN_PROGRESS', label: 'In Progress',color: 'primary' },
    { value: 'DONE',        label: 'Done',       color: 'success' },
    { value: 'CANCELLED',   label: 'Cancelled',  color: 'danger'  },
  ],
  task_priority: [
    { value: 'LOW',    label: 'Low',    color: 'default'  },
    { value: 'MEDIUM', label: 'Medium', color: 'warning'  },
    { value: 'HIGH',   label: 'High',   color: 'danger'   },
    { value: 'URGENT', label: 'Urgent', color: 'danger'   },
  ],
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

  async create(data: {
    category: string;
    value: string;
    label: string;
    color?: string;
    sortOrder?: number;
    createdById: string;
  }) {
    return this.prisma.customOption.create({ data });
  }

  async update(
    id: string,
    data: { label?: string; color?: string; sortOrder?: number; isActive?: boolean },
  ) {
    const opt = await this.prisma.customOption.findUnique({ where: { id } });
    if (!opt) throw new NotFoundException('Custom option not found');
    return this.prisma.customOption.update({ where: { id }, data });
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
