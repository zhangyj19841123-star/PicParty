import desktopConfig from '../src-tauri/tauri.conf.json';

export const brand = {
  name: desktopConfig.productName,
  englishName: desktopConfig.productName.split(' ').at(-1)!,
  tagline: '照片拼一拼，灵感派起来。',
  subtitle: desktopConfig.bundle.shortDescription,
  iconUrl: '/brand/picparty-128.png',
  heroIconUrl: '/brand/picparty-512.png',
};
