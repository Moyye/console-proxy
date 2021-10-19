import { AES, enc, MD5 } from 'crypto-js';
import { Logger } from '@nestjs/common';

const logger: Logger = new Logger('Kit');

export const md5 = (str: string): string => {
  return MD5(str).toString();
};

export const decrypt = (str: string, secret: string): string => {
  return AES.decrypt(str, secret).toString(enc.Utf8);
};

export const encrypt = (str: string, secret: string): string => {
  return AES.encrypt(str, secret).toString();
};

export function sleep(ms: number): Promise<void> {
  if (ms === 0) {
    // 直接完成
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function WsErrorCatch(originError = false): MethodDecorator {
  return (_, __, descriptor: TypedPropertyDescriptor<any>): void => {
    const originalMethod = descriptor.value;
    descriptor.value = async function fn(...args) {
      try {
        return await originalMethod.apply(this, [...args]);
      } catch (e) {
        logger.error('[WsErrorCatch] error', e.stack || e.message);
        if (originError) {
          return e;
        }
        return {
          errorMessage: e.message,
        };
      }
    };

    Reflect.getMetadataKeys(originalMethod).forEach((previousMetadataKey) => {
      const previousMetadata = Reflect.getMetadata(
        previousMetadataKey,
        originalMethod,
      );
      Reflect.defineMetadata(
        previousMetadataKey,
        previousMetadata,
        descriptor.value,
      );
    });

    Object.defineProperty(descriptor.value, 'name', {
      value: originalMethod.name,
      writable: false,
    });
  };
}
