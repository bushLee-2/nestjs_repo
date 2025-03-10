import { Test, TestingModule } from '@nestjs/testing';
import { UploadV2Controller } from './upload-v2.controller';

describe('UploadV2Controller', () => {
  let controller: UploadV2Controller;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadV2Controller],
    }).compile();

    controller = module.get<UploadV2Controller>(UploadV2Controller);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
