/* eslint-disable max-len */
import { Socket } from 'socket.io';
import events from 'events';
import {
  FileEntry,
  InputAttributes,
  ReadFileOptions,
  ReadStreamOptions,
  Stats,
  TransferOptions,
  WriteFileOptions,
  WriteStreamOptions,
} from 'ssh2-streams';
import stream from 'stream';
import { Sftp, Shell, Redis, ServerStatus } from './app.service';

export interface ConsoleSocket extends Socket {
  shellService?: Shell;
  sftpService?: Sftp;
  serverStatusService?: ServerStatus;
  redisService?: Redis;
}

export interface SFTP extends events.EventEmitter {
  /**
   * (Client-only)
   * Downloads a file at `remotePath` to `localPath` using parallel reads for faster throughput.
   */
  fastGet(
    remotePath: string,
    localPath: string,
    options: TransferOptions,
    callback: (err: any) => void,
  ): void;

  /**
   * (Client-only)
   * Downloads a file at `remotePath` to `localPath` using parallel reads for faster throughput.
   */
  fastGet(
    remotePath: string,
    localPath: string,
    callback: (err: any) => void,
  ): void;

  /**
   * (Client-only)
   * Uploads a file from `localPath` to `remotePath` using parallel reads for faster throughput.
   */
  fastPut(
    localPath: string,
    remotePath: string,
    options: TransferOptions,
    callback: (err: any) => void,
  ): void;

  /**
   * (Client-only)
   * Uploads a file from `localPath` to `remotePath` using parallel reads for faster throughput.
   */
  fastPut(
    localPath: string,
    remotePath: string,
    callback: (err: any) => void,
  ): void;

  /**
   * (Client-only)
   * Reads a file in memory and returns its contents
   */
  readFile(remotePath: string, options: ReadFileOptions): Promise<Buffer>;

  /**
   * (Client-only)
   * Reads a file in memory and returns its contents
   */
  readFile(
    remotePath: string,
    encoding: string,
    callback: (err: any, handle: Buffer) => void,
  ): void;

  /**
   * (Client-only)
   * Reads a file in memory and returns its contents
   */
  readFile(
    remotePath: string,
    callback: (err: any, handle: Buffer) => void,
  ): void;

  /**
   * (Client-only)
   * Returns a new readable stream for `path`.
   */
  createReadStream(path: string, options?: ReadStreamOptions): stream.Readable;

  /**
   * (Client-only)
   * Writes data to a file
   */
  writeFile(
    remotePath: string,
    data: string | Buffer,
    options: WriteFileOptions,
    callback?: (err: any) => void,
  ): void;

  /**
   * (Client-only)
   * Writes data to a file
   */
  writeFile(
    remotePath: string,
    data: string | Buffer,
    encoding: string,
    callback?: (err: any) => void,
  ): void;

  /**
   * (Client-only)
   * Writes data to a file
   */
  writeFile(remotePath: string, data: string | Buffer): Promise<void>;

  /**
   * (Client-only)
   * Returns a new writable stream for `path`.
   */
  createWriteStream(
    path: string,
    options?: WriteStreamOptions,
  ): stream.Writable;

  /**
   * (Client-only)
   * Opens a file `filename` for `mode` with optional `attributes`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  open(
    filename: string,
    mode: string,
    attributes: InputAttributes,
    callback: (err: any, handle: Buffer) => void,
  ): boolean;

  /**
   * (Client-only)
   * Opens a file `filename` for `mode`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  open(
    filename: string,
    mode: string,
    callback: (err: any, handle: Buffer) => void,
  ): boolean;

  /**
   * (Client-only)
   * Closes the resource associated with `handle` given by `open()` or `opendir()`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  close(handle: Buffer, callback: (err: any) => void): boolean;

  /**
   * (Client-only)
   * Reads `length` bytes from the resource associated with `handle` starting at `position`
   * and stores the bytes in `buffer` starting at `offset`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  read(
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (
      err: any,
      bytesRead: number,
      buffer: Buffer,
      position: number,
    ) => void,
  ): boolean;

  /**
   * (Client-only)
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  write(
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only)
   * Retrieves attributes for the resource associated with `handle`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  fstat(handle: Buffer, callback: (err: any, stats: Stats) => void): boolean;

  /**
   * (Client-only)
   * Sets the attributes defined in `attributes` for the resource associated with `handle`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  fsetstat(
    handle: Buffer,
    attributes: InputAttributes,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only)
   * Sets the access time and modified time for the resource associated with `handle`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  futimes(
    handle: Buffer,
    atime: number | Date,
    mtime: number | Date,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only)
   * Sets the owner for the resource associated with `handle`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  fchown(
    handle: Buffer,
    uid: number,
    gid: number,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only)
   * Sets the mode for the resource associated with `handle`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  fchmod(
    handle: Buffer,
    mode: number | string,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only)
   * Opens a directory `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  opendir(path: string, callback: (err: any, handle: Buffer) => void): boolean;

  /**
   * (Client-only)
   * Retrieves a directory listing.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  readdir(location: string | Buffer): Promise<FileEntry[]>;

  /**
   * (Client-only)
   * Removes the file/symlink at `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  unlink(path: string): Promise<boolean>;

  /**
   * (Client-only)
   * Renames/moves `srcPath` to `destPath`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  rename(srcPath: string, destPath: string): Promise<boolean>;

  /**
   * (Client-only)
   * Creates a new directory `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  mkdir(path: string, attributes: InputAttributes): Promise<void>;

  /**
   * (Client-only)
   * Creates a new directory `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  mkdir(path: string, callback: (err: any) => void): boolean;

  /**
   * (Client-only)
   * Removes the directory at `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  rmdir(path: string): Promise<void>;

  /**
   * (Client-only)
   * Retrieves attributes for `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  stat(path: string, callback: (err: any, stats: Stats) => void): boolean;

  /**
   * (Client-only)
   * `path` exists.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  exists(path: string, callback: (err: any) => void): boolean;

  /**
   * (Client-only)
   * Retrieves attributes for `path`. If `path` is a symlink, the link itself is stat'ed
   * instead of the resource it refers to.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  lstat(path: string, callback: (err: any, stats: Stats) => void): boolean;

  /**
   * (Client-only)
   * Sets the attributes defined in `attributes` for `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  setstat(
    path: string,
    attributes: InputAttributes,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only)
   * Sets the access time and modified time for `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  utimes(
    path: string,
    atime: number | Date,
    mtime: number | Date,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only)
   * Sets the owner for `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  chown(
    path: string,
    uid: number,
    gid: number,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only)
   * Sets the mode for `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  chmod(
    path: string,
    mode: number | string,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only)
   * Retrieves the target for a symlink at `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  readlink(path: string, callback: (err: any, target: string) => void): boolean;

  /**
   * (Client-only)
   * Creates a symlink at `linkPath` to `targetPath`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  symlink(
    targetPath: string,
    linkPath: string,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only)
   * Resolves `path` to an absolute path.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  realpath(
    path: string,
    callback: (err: any, absPath: string) => void,
  ): boolean;

  /**
   * (Client-only, OpenSSH extension)
   * Performs POSIX rename(3) from `srcPath` to `destPath`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  ext_openssh_rename(
    srcPath: string,
    destPath: string,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only, OpenSSH extension)
   * Performs POSIX statvfs(2) on `path`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  ext_openssh_statvfs(
    path: string,
    callback: (err: any, fsInfo: any) => void,
  ): boolean;

  /**
   * (Client-only, OpenSSH extension)
   * Performs POSIX fstatvfs(2) on open handle `handle`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  ext_openssh_fstatvfs(
    handle: Buffer,
    callback: (err: any, fsInfo: any) => void,
  ): boolean;

  /**
   * (Client-only, OpenSSH extension)
   * Performs POSIX link(2) to create a hard link to `targetPath` at `linkPath`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  ext_openssh_hardlink(
    targetPath: string,
    linkPath: string,
    callback: (err: any) => void,
  ): boolean;

  /**
   * (Client-only, OpenSSH extension)
   * Performs POSIX fsync(3) on the open handle `handle`.
   *
   * Returns `false` if you should wait for the `continue` event before sending any more traffic.
   */
  ext_openssh_fsync(
    handle: Buffer,
    callback: (err: any, fsInfo: any) => void,
  ): boolean;

  /**
   * Ends the stream.
   */
  end(): void;

  /**
   * Emitted when an error occurred.
   */
  on(event: 'error', listener: (err: any) => void): this;

  /**
   * Emitted when the session has ended.
   */
  on(event: 'end', listener: () => void): this;

  /**
   * Emitted when the session has closed.
   */
  on(event: 'close', listener: () => void): this;

  /**
   * Emitted when more requests/data can be sent to the stream.
   */
  on(event: 'continue', listener: () => void): this;

  on(event: string | symbol, listener: any): this;
}
