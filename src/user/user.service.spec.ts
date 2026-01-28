import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from 'prisma/prisma.service';
import { randomInt } from 'crypto';
import { identity } from 'rxjs';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockedPrisma = {
  user: {
    update: jest.fn(),
  },
};

describe('UserService', () => {
  let service: UserService;
  let prisma;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockedPrisma },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Edit user data', () => {
    it('Should successfully edit user data', async () => {
      const generatedUserData = {
        id: randomInt(100000),
        fullname: 'test',
        login: 'test12',
        email: 'test@test.com',
        isAdmin: false,
      };
      prisma.user.update.mockResolvedValue(generatedUserData);

      const result = service.editUserData(generatedUserData.id, {
        email: generatedUserData.email,
        login: generatedUserData.login,
      });

      await expect(result).resolves.toEqual(generatedUserData);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: generatedUserData.id },
        data: {
          email: generatedUserData.email,
          login: generatedUserData.login,
        },
      });
    });

    it('Should throw an error if user not found', async () => {
      const generatedUserData = {
        id: randomInt(100000),
        fullname: 'test',
        login: 'test12',
        email: 'test@test.com',
      };
      prisma.user.update.mockRejectedValue(new Error());

      const result = service.editUserData(generatedUserData.id, {
        email: generatedUserData.email,
        login: generatedUserData.login,
      });

      await expect(result).rejects.toEqual(BadRequestException);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: generatedUserData.id },
        data: {
          email: generatedUserData.email,
          login: generatedUserData.login,
        },
      });
    });
  });
});
