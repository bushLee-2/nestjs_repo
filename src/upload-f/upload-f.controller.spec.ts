import { Test, TestingModule } from '@nestjs/testing';
import { UploadFController } from './upload-f.controller';

describe('UploadFController', () => {
  let controller: UploadFController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadFController],
    }).compile();

    controller = module.get<UploadFController>(UploadFController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
