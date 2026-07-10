import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';

@Injectable()
export class VendorsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.vendor.findMany({ orderBy: { name: 'asc' } });
  }

  async create(data: CreateVendorDto) {
    return this.prisma.vendor.create({
      data: {
        name: data.name,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        trade: data.trade,
      },
    });
  }

  async update(id: string, data: UpdateVendorDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.prisma.vendor.update({ where: { id }, data });
  }

  async delete(id: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.prisma.vendor.delete({ where: { id } });
  }
}
