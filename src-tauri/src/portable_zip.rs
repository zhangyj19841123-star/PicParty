//! A deliberately small ZIP profile: Store output, Store/Deflate input, no
//! encryption/ZIP64/multi-volume archives. Photos are already compressed.
//! All offsets, paths, counts and expanded lengths are checked before writing.
use anyhow::{bail, Context, Result};
use std::{collections::BTreeSet, fs::{self,File}, io::{Read,Seek,SeekFrom,Write}, path::Path, sync::atomic::{AtomicBool,Ordering}};

pub const MAX_TOTAL: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_FILE: u64 = 1024 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 20_010;
const MAX_CENTRAL: u64 = 16 * 1024 * 1024;
#[derive(Debug,Clone)]
pub struct ZipEntry { pub name: String, pub size: u64, pub directory: bool, offset: u64, compressed: u64, crc: u32, method: u16 }

pub fn check_cancel(cancel: &AtomicBool) -> Result<()> { if cancel.load(Ordering::Relaxed) { bail!("操作已取消"); } Ok(()) }
fn u16le(bytes: &[u8], at: usize) -> Result<u16> { Ok(u16::from_le_bytes(bytes.get(at..at+2).context("ZIP 文件被截断")?.try_into()?)) }
fn u32le(bytes: &[u8], at: usize) -> Result<u32> { Ok(u32::from_le_bytes(bytes.get(at..at+4).context("ZIP 文件被截断")?.try_into()?)) }
fn write16(out: &mut impl Write, value: u16) -> Result<()> { out.write_all(&value.to_le_bytes())?; Ok(()) }
fn write32(out: &mut impl Write, value: u32) -> Result<()> { out.write_all(&value.to_le_bytes())?; Ok(()) }

pub fn safe_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 512 || name.starts_with('/') || name.contains(['\\',':']) || name.chars().any(char::is_control) { bail!("ZIP 包含不安全的路径"); }
    let body = name.strip_suffix('/').unwrap_or(name);
    if body.split('/').count() > 5 || body.split('/').any(|part| part.is_empty() || part == "." || part == "..") { bail!("ZIP 不允许路径穿越或多余路径层级"); }
    Ok(())
}
fn check_extra(bytes: &[u8]) -> Result<()> {
    let mut i = 0;
    while i < bytes.len() {
        let key = u16le(bytes,i)?; let length = u16le(bytes,i+2)? as usize;
        if key == 1 { bail!("此版本不接受 ZIP64 归档，请使用标准 ZIP"); }
        i = i.checked_add(length+4).context("ZIP 扩展字段无效")?;
        if i > bytes.len() { bail!("ZIP 扩展字段被截断"); }
    }
    Ok(())
}
pub fn read_directory(path: &Path) -> Result<Vec<ZipEntry>> {
    read_directory_with_cancel(path, &AtomicBool::new(false))
}

/// Header validation also reads each local-file header on the source disk.
/// Give background jobs a cancellation point between those bounded reads.
pub fn read_directory_with_cancel(path: &Path, cancel: &AtomicBool) -> Result<Vec<ZipEntry>> {
    check_cancel(cancel)?;
    let mut file = File::open(path)?; let length = file.metadata()?.len();
    if !(22..=MAX_TOTAL+MAX_CENTRAL).contains(&length) { bail!("ZIP 大小无效或超过 2 GiB 安全上限"); }
    let tail_len = length.min(65_557) as usize;
    file.seek(SeekFrom::Start(length-tail_len as u64))?;
    let mut tail = vec![0;tail_len]; file.read_exact(&mut tail)?;
    let end = (0..=tail_len-22).rev().find(|i| tail.get(*i..*i+4) == Some(&[0x50,0x4b,0x05,0x06]) && u16le(&tail,*i+20).is_ok_and(|comment| *i+22+comment as usize == tail_len)).context("未找到有效 ZIP 目录")?;
    if u16le(&tail,end+4)? != 0 || u16le(&tail,end+6)? != 0 || u16le(&tail,end+8)? != u16le(&tail,end+10)? { bail!("不支持多卷 ZIP"); }
    let count = u16le(&tail,end+10)? as usize; let central_size = u32le(&tail,end+12)? as u64; let central_at = u32le(&tail,end+16)? as u64;
    if count == 0 || count > MAX_ENTRIES || central_size > MAX_CENTRAL || central_at.checked_add(central_size) != Some(length-tail_len as u64+end as u64) { bail!("ZIP 目录数量或偏移无效"); }
    file.seek(SeekFrom::Start(central_at))?; let mut central = vec![0;central_size as usize]; file.read_exact(&mut central)?;
    let mut entries = vec![]; let mut cursor = 0; let mut names = BTreeSet::new(); let mut total = 0u64; let mut ranges = vec![];
    for _ in 0..count {
        check_cancel(cancel)?;
        if u32le(&central,cursor)? != 0x02014b50 { bail!("ZIP 中央目录损坏"); }
        let flag = u16le(&central,cursor+8)?; let method = u16le(&central,cursor+10)?;
        if flag & 1 != 0 || flag & !(0x800|8|6) != 0 || !matches!(method,0|8) { bail!("ZIP 加密或压缩方法不受支持"); }
        let crc = u32le(&central,cursor+16)?; let compressed = u32le(&central,cursor+20)? as u64; let size = u32le(&central,cursor+24)? as u64;
        let name_len = u16le(&central,cursor+28)? as usize; let extra_len = u16le(&central,cursor+30)? as usize; let comment_len = u16le(&central,cursor+32)? as usize;
        if u16le(&central,cursor+34)? != 0 { bail!("ZIP 条目跨卷无效"); }
        let attributes = u32le(&central,cursor+38)?; let mode = (attributes >> 16) & 0xf000;
        if mode != 0 && mode != 0x8000 && mode != 0x4000 { bail!("ZIP 不允许符号链接、设备或其他特殊文件"); }
        let local_at = u32le(&central,cursor+42)? as u64;
        let name_bytes = central.get(cursor+46..cursor+46+name_len).context("ZIP 文件名被截断")?;
        let name = std::str::from_utf8(name_bytes).context("ZIP 文件名必须是 UTF-8")?.to_string(); safe_name(&name)?;
        if !names.insert(name.to_lowercase()) { bail!("ZIP 包含重复文件名"); }
        check_extra(central.get(cursor+46+name_len..cursor+46+name_len+extra_len).context("ZIP 扩展字段被截断")?)?;
        let directory = name.ends_with('/');
        if mode == 0x4000 && !directory || mode == 0x8000 && directory { bail!("ZIP 文件类型与路径不一致"); }
        if size > MAX_FILE || compressed > MAX_TOTAL || directory && (size != 0 || compressed != 0) { bail!("ZIP 单文件超过 1 GiB 或目录无效"); }
        total = total.checked_add(size).context("ZIP 长度溢出")?;
        if total > MAX_TOTAL || size > 64*1024*1024 && compressed.saturating_mul(2000) < size { bail!("ZIP 展开大小或压缩比例超过安全上限"); }
        if method == 0 && compressed != size { bail!("ZIP Store 条目大小不一致"); }
        file.seek(SeekFrom::Start(local_at))?; let mut local = [0u8;30]; file.read_exact(&mut local)?;
        if u32le(&local,0)? != 0x04034b50 || u16le(&local,6)? != flag || u16le(&local,8)? != method { bail!("ZIP 本地头与目录不一致"); }
        let local_name_len = u16le(&local,26)? as usize; let local_extra_len = u16le(&local,28)? as usize;
        let mut local_name = vec![0;local_name_len]; file.read_exact(&mut local_name)?;
        if local_name != name_bytes { bail!("ZIP 本地文件名与目录不一致"); }
        let mut extra = vec![0;local_extra_len]; file.read_exact(&mut extra)?; check_extra(&extra)?;
        if flag & 8 == 0 && (u32le(&local,14)? != crc || u32le(&local,18)? as u64 != compressed || u32le(&local,22)? as u64 != size) { bail!("ZIP 本地校验与目录不一致"); }
        let offset = local_at.checked_add(30+local_name_len as u64+local_extra_len as u64).context("ZIP 偏移溢出")?;
        let data_end = offset.checked_add(compressed).context("ZIP 数据长度溢出")?;
        if data_end > central_at { bail!("ZIP 数据越过文件边界"); }
        ranges.push((local_at,data_end)); entries.push(ZipEntry { name,size,directory,offset,compressed,crc,method });
        cursor = cursor.checked_add(46+name_len+extra_len+comment_len).context("ZIP 目录长度溢出")?;
        if cursor > central.len() { bail!("ZIP 目录被截断"); }
    }
    if cursor != central.len() { bail!("ZIP 目录包含无法识别的条目"); }
    ranges.sort_unstable(); if ranges.windows(2).any(|w|w[0].1>w[1].0) { bail!("ZIP 文件区域重叠"); }
    check_cancel(cancel)?;
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression,write::DeflateEncoder};
    fn fixture(path:&Path,items:&[(&str,&[u8],u16,u32)]) {
        let mut output=File::create(path).unwrap();let mut central=vec![];
        for (name,bytes,method,attributes) in items {
            let compressed=if *method==8{let mut encoder=DeflateEncoder::new(Vec::new(),Compression::default());encoder.write_all(bytes).unwrap();encoder.finish().unwrap()}else{bytes.to_vec()};
            let offset=output.stream_position().unwrap() as u32;let crc=crc32fast::hash(bytes);
            for value in [0x04034b50u32]{write32(&mut output,value).unwrap();}
            for value in [20u16,0x800,*method,0,0x21]{write16(&mut output,value).unwrap();}
            for value in [crc,compressed.len() as u32,bytes.len() as u32]{write32(&mut output,value).unwrap();}
            write16(&mut output,name.len() as u16).unwrap();write16(&mut output,0).unwrap();output.write_all(name.as_bytes()).unwrap();output.write_all(&compressed).unwrap();
            write32(&mut central,0x02014b50).unwrap();for value in [(3<<8)|20u16,20,0x800,*method,0,0x21]{write16(&mut central,value).unwrap();}
            for value in [crc,compressed.len() as u32,bytes.len() as u32]{write32(&mut central,value).unwrap();}
            for value in [name.len() as u16,0,0,0,0]{write16(&mut central,value).unwrap();}
            write32(&mut central,*attributes).unwrap();write32(&mut central,offset).unwrap();central.extend_from_slice(name.as_bytes());
        }
        let offset=output.stream_position().unwrap() as u32;output.write_all(&central).unwrap();write32(&mut output,0x06054b50).unwrap();
        for value in [0u16,0,items.len() as u16,items.len() as u16]{write16(&mut output,value).unwrap();}
        write32(&mut output,central.len() as u32).unwrap();write32(&mut output,offset).unwrap();write16(&mut output,0).unwrap();output.sync_all().unwrap();
    }
    #[test]
    fn store_and_deflate_input_extract_with_exact_crc_and_bytes(){
        let temp=tempfile::tempdir().unwrap();let path=temp.path().join("photos.zip");let expanded=b"deflate payload ".repeat(10000);
        fixture(&path,&[("摄影/project.json",b"{}",0,0o100644<<16),("摄影/assets/000001.png",&expanded,8,0o100644<<16)]);
        let entries=read_directory(&path).unwrap();let cancel=AtomicBool::new(false);verify(&path,&entries,&cancel).unwrap();
        let target=tempfile::tempdir().unwrap();extract(&path,&entries,target.path(),&cancel,|_,_|{}).unwrap();
        assert_eq!(fs::read(target.path().join("摄影/assets/000001.png")).unwrap(),expanded);
    }
    #[test]
    fn rejects_traversal_absolute_links_duplicate_names_and_special_files_before_extraction(){
        let temp=tempfile::tempdir().unwrap();let path=temp.path().join("bad.zip");
        for name in ["../escape","/absolute","a/../escape","a//b","a/./b","a\\b","C:/escape","a/\0b"] {
            fixture(&path,&[(name,b"pixels",0,0o100644<<16)]);assert!(read_directory(&path).is_err(),"{name}");
        }
        for mode in [0o120777u32,0o060600,0o020600]{fixture(&path,&[("assets/a.png",b"target",0,mode<<16)]);assert!(read_directory(&path).is_err());}
        fixture(&path,&[("assets/A.png",b"one",0,0o100644<<16),("assets/a.png",b"two",0,0o100644<<16)]);assert!(read_directory(&path).is_err());
        fixture(&path,&[("assets/folder",b"",0,0o040755<<16)]);assert!(read_directory(&path).is_err());
    }
    #[test]
    fn detects_payload_corruption_and_truncation_without_trusting_central_crc(){
        let temp=tempfile::tempdir().unwrap();let path=temp.path().join("bad.zip");fixture(&path,&[("assets/a.png",b"some pixels",0,0o100644<<16)]);
        let entries=read_directory(&path).unwrap();let mut bytes=fs::read(&path).unwrap();bytes[entries[0].offset as usize]^=0xff;fs::write(&path,&bytes).unwrap();
        assert!(verify(&path,&entries,&AtomicBool::new(false)).is_err());
        bytes.truncate(bytes.len()-8);fs::write(&path,bytes).unwrap();assert!(read_directory(&path).is_err());
    }
    #[test]
    fn rejects_declared_zip_bombs_zip64_encryption_and_overlapping_payloads(){
        let temp=tempfile::tempdir().unwrap();let path=temp.path().join("bad.zip");
        let original=||{fixture(&path,&[("assets/a.png",b"abc",8,0o100644<<16)]);fs::read(&path).unwrap()};
        let mut bytes=original();let central=bytes.windows(4).position(|w|w==[0x50,0x4b,0x01,0x02]).unwrap();
        bytes[central+24..central+28].copy_from_slice(&((MAX_FILE+1) as u32).to_le_bytes());fs::write(&path,bytes).unwrap();assert!(read_directory(&path).is_err());
        let mut bytes=original();bytes[6..8].copy_from_slice(&0x801u16.to_le_bytes());bytes[central+8..central+10].copy_from_slice(&0x801u16.to_le_bytes());fs::write(&path,bytes).unwrap();assert!(read_directory(&path).is_err());
        let mut bytes=original();bytes[central+42..central+46].copy_from_slice(&0xffff_ffffu32.to_le_bytes());fs::write(&path,bytes).unwrap();assert!(read_directory(&path).is_err());
        fixture(&path,&[("a",b"one",0,0o100644<<16),("b",b"two",0,0o100644<<16)]);
        let mut bytes=fs::read(&path).unwrap();let offsets:Vec<_>=bytes.windows(4).enumerate().filter_map(|(i,w)|(w==[0x50,0x4b,0x01,0x02]).then_some(i)).collect();
        bytes[offsets[1]+42..offsets[1]+46].copy_from_slice(&0u32.to_le_bytes());fs::write(&path,bytes).unwrap();assert!(read_directory(&path).is_err());
    }
    #[test]
    fn stored_writer_is_standard_zip_and_cancel_never_commits_a_finished_file(){
        let temp=tempfile::tempdir().unwrap();let source=temp.path().join("photo.png");fs::write(&source,b"photo bytes").unwrap();
        let path=temp.path().join("out.zip");let mut output=File::create(&path).unwrap();
        write_stored(&mut output,&[("拼图/assets/000001.png".into(),source.clone())],&AtomicBool::new(false),|_,_|{}).unwrap();
        let entries=read_directory(&path).unwrap();verify(&path,&entries,&AtomicBool::new(false)).unwrap();
        assert!(copy_with_cancel(&source,&temp.path().join("cancelled.png"),&AtomicBool::new(true)).is_err());
        assert!(verify(&path,&entries,&AtomicBool::new(true)).is_err());
    }
    #[test]
    fn directory_validation_honors_cancellation_before_reading_payload_headers() {
        let temp = tempfile::tempdir().unwrap(); let path = temp.path().join("photos.zip");
        fixture(&path, &[("assets/a.png", b"pixels", 0, 0o100644 << 16)]);
        let bytes = fs::read(&path).unwrap();
        assert!(read_directory_with_cancel(&path, &AtomicBool::new(true)).unwrap_err().to_string().contains("取消"));
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(read_directory_with_cancel(&path, &AtomicBool::new(false)).unwrap().len(), 1);
    }
}

pub fn extract(path: &Path, entries: &[ZipEntry], target: &Path, cancel: &AtomicBool, mut progress: impl FnMut(usize,usize)) -> Result<()> {
    let mut zip = File::open(path)?;
    for (index,entry) in entries.iter().enumerate() {
        check_cancel(cancel)?; safe_name(&entry.name)?;
        let destination = target.join(&entry.name);
        if entry.directory { fs::create_dir_all(&destination)?; continue; }
        if let Some(parent) = destination.parent() { fs::create_dir_all(parent)?; }
        // The target is always a freshly created, private temporary directory.
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&destination)?;
        zip.seek(SeekFrom::Start(entry.offset))?;
        let input = (&mut zip).take(entry.compressed);
        let mut reader: Box<dyn Read + '_> = if entry.method == 8 { Box::new(flate2::read::DeflateDecoder::new(input)) } else { Box::new(input) };
        let mut crc = crc32fast::Hasher::new(); let mut count = 0u64; let mut buffer = [0;64*1024];
        loop {
            check_cancel(cancel)?; let n = reader.read(&mut buffer)?; if n == 0 { break; }
            count = count.checked_add(n as u64).context("ZIP 展开长度溢出")?;
            if count > entry.size { bail!("ZIP 展开长度超过声明值"); }
            crc.update(&buffer[..n]); output.write_all(&buffer[..n])?;
        }
        if count != entry.size || crc.finalize() != entry.crc { bail!("ZIP 文件大小或 CRC 校验失败"); }
        output.sync_all()?; progress(index+1,entries.len());
    }
    Ok(())
}

/// Check every compressed payload without materializing a second photo copy.
pub fn verify(path: &Path, entries: &[ZipEntry], cancel: &AtomicBool) -> Result<()> {
    let mut zip = File::open(path)?;
    for entry in entries.iter().filter(|e| !e.directory) {
        check_cancel(cancel)?; zip.seek(SeekFrom::Start(entry.offset))?;
        let input = (&mut zip).take(entry.compressed);
        let mut reader: Box<dyn Read + '_> = if entry.method == 8 { Box::new(flate2::read::DeflateDecoder::new(input)) } else { Box::new(input) };
        let mut crc = crc32fast::Hasher::new(); let mut count = 0u64; let mut buffer = [0;64*1024];
        loop { check_cancel(cancel)?; let n=reader.read(&mut buffer)?; if n==0 {break;} count+=n as u64; if count>entry.size {bail!("ZIP 展开长度超过声明值");} crc.update(&buffer[..n]); }
        if count!=entry.size || crc.finalize()!=entry.crc {bail!("ZIP 内容完整性校验失败");}
    }
    Ok(())
}

pub fn copy_with_cancel(source: &Path, destination: &Path, cancel: &AtomicBool) -> Result<(u64,String)> {
    let mut input = File::open(source)?; let metadata = input.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_FILE { bail!("素材不是普通文件或超过 1 GiB"); }
    let mut output = fs::OpenOptions::new().write(true).create_new(true).open(destination)?;
    let mut hasher = blake3::Hasher::new(); let mut total = 0u64; let mut buffer = [0;64*1024];
    loop { check_cancel(cancel)?; let n = input.read(&mut buffer)?; if n == 0 { break; }
        total += n as u64; if total > MAX_FILE { bail!("素材读取超过 1 GiB"); }
        hasher.update(&buffer[..n]); output.write_all(&buffer[..n])?;
    }
    if total != metadata.len() { bail!("素材在打包过程中变化，请重试"); }
    output.sync_all()?; Ok((total,hasher.finalize().to_hex().to_string()))
}

/// Entries are generated by the application, but validate them just as imported
/// entries. The caller persists this file exclusively only after verification.
pub fn write_stored(output: &mut File, entries: &[(String,std::path::PathBuf)], cancel: &AtomicBool, mut progress: impl FnMut(usize,usize)) -> Result<()> {
    if entries.is_empty() || entries.len() > MAX_ENTRIES { bail!("归档条目数量超过上限"); }
    let mut central = Vec::new(); let mut total = 0u64; let mut names = BTreeSet::new();
    for (index,(name,path)) in entries.iter().enumerate() {
        check_cancel(cancel)?; safe_name(name)?;
        if !names.insert(name.to_lowercase()) { bail!("归档文件名重复"); }
        let metadata = fs::metadata(path)?;
        if !metadata.is_file() || metadata.len() > MAX_FILE { bail!("归档文件超过单文件上限"); }
        total += metadata.len(); if total > MAX_TOTAL { bail!("归档超过 2 GiB 安全上限"); }
        let size = u32::try_from(metadata.len())?; let mut input = File::open(path)?; let mut hasher = crc32fast::Hasher::new(); let mut buffer = [0;64*1024];
        loop { check_cancel(cancel)?; let n = input.read(&mut buffer)?; if n == 0 {break;} hasher.update(&buffer[..n]); }
        let crc = hasher.finalize(); input.seek(SeekFrom::Start(0))?;
        let offset = u32::try_from(output.stream_position()?)?;
        write32(output,0x04034b50)?; write16(output,20)?; write16(output,0x800)?; write16(output,0)?; write16(output,0)?; write16(output,0x21)?;
        write32(output,crc)?; write32(output,size)?; write32(output,size)?; write16(output,name.len() as u16)?; write16(output,0)?; output.write_all(name.as_bytes())?;
        let mut copied = 0u64; let mut checked = crc32fast::Hasher::new();
        loop { check_cancel(cancel)?; let n = input.read(&mut buffer)?; if n == 0 { break; } copied+=n as u64; if copied>size as u64 {bail!("归档暂存文件发生变化");} checked.update(&buffer[..n]); output.write_all(&buffer[..n])?; }
        if copied != size as u64 || checked.finalize() != crc { bail!("归档暂存文件发生变化"); }
        write32(&mut central,0x02014b50)?; write16(&mut central,(3<<8)|20)?; write16(&mut central,20)?; write16(&mut central,0x800)?; write16(&mut central,0)?; write16(&mut central,0)?; write16(&mut central,0x21)?;
        write32(&mut central,crc)?; write32(&mut central,size)?; write32(&mut central,size)?; write16(&mut central,name.len() as u16)?; write16(&mut central,0)?; write16(&mut central,0)?; write16(&mut central,0)?; write16(&mut central,0)?; write32(&mut central,0o100644<<16)?; write32(&mut central,offset)?; central.extend_from_slice(name.as_bytes());
        progress(index+1,entries.len());
    }
    let at = u32::try_from(output.stream_position()?)?; output.write_all(&central)?;
    write32(output,0x06054b50)?; write16(output,0)?; write16(output,0)?; write16(output,entries.len() as u16)?; write16(output,entries.len() as u16)?; write32(output,central.len() as u32)?; write32(output,at)?; write16(output,0)?;
    output.sync_all()?; Ok(())
}
