# PicParty macOS 第三方声明

这份清单对应当前锁文件解析出的 macOS arm64 原生运行依赖、画布使用的 WebAssembly 和前端生产依赖。它按目标和依赖类型整理，包含可能被链接器裁剪的运行依赖。开发工具、测试依赖及其他平台专属依赖未列入。第三方组件的许可证和版权归其各自权利人。

下表的版本链接提供上游源码入口。原始许可证及版权声明集中在 [third-party-licenses/LICENSES.txt](third-party-licenses/LICENSES.txt)，可按表中的编号查找。同一原文若出现在多个组件中仅收录一次。

## 发行时需保留的声明

This software is based in part on the work of the Independent JPEG Group.

原生 JPEG 编码使用 jpeg-encoder。其组合授权包含 IJG 条款，安装包须随附上述声明。完整上游文本在下表的 jpeg-encoder 项下。

原生目录定位通过 dirs 间接使用 MPL-2.0 的 option-ext 0.2.0。该组件保留 MPL-2.0，收件人可获取对应版本的源码和许可证。[获取 option-ext 0.2.0 源码](https://static.crates.io/crates/option-ext/option-ext-0.2.0.crate)

objc2 上游对 Apple SDK 派生绑定作了授权说明。PicParty 链接 macOS 系统框架，通过 Xcode SDK 构建，发行包不附带 Xcode SDK 或 Apple 系统框架。[查看 objc2 的上游说明](https://github.com/madsmtm/objc2/blob/8852b424193ca41602281b3d7540d7c8ed51e49a/LICENSE.md)

发行包链接系统 WebKit 等 macOS 组件，文字水印使用本机安装的字体。

## 运行依赖

| 来源 | 组件与版本 | 上游声明的许可证 | 文本编号 |
| --- | --- | --- | --- |
| Rust/macOS | [adler2 2.0.1](https://crates.io/crates/adler2/2.0.1) | 0BSD OR MIT OR Apache-2.0 | L001, L002, L003 |
| Rust/macOS | [aho-corasick 1.1.5](https://crates.io/crates/aho-corasick/1.1.5) | Unlicense OR MIT | L004, L005, L006 |
| Rust/macOS | [alloc-no-stdlib 3.0.0](https://crates.io/crates/alloc-no-stdlib/3.0.0) | BSD-3-Clause | L007 |
| Rust/macOS | [alloc-stdlib 0.3.0](https://crates.io/crates/alloc-stdlib/0.3.0) | BSD-3-Clause | L007 |
| Rust/macOS | [anyhow 1.0.104](https://crates.io/crates/anyhow/1.0.104) | MIT OR Apache-2.0 | L008, L003 |
| Rust/macOS | [arrayvec 0.7.8](https://crates.io/crates/arrayvec/0.7.8) | MIT OR Apache-2.0 | L009, L010 |
| Rust/macOS | [base64 0.22.1](https://crates.io/crates/base64/0.22.1) | MIT OR Apache-2.0 | L009, L011 |
| Rust/macOS | [base64 0.23.1](https://crates.io/crates/base64/0.23.1) | MIT OR Apache-2.0 | L009, L012 |
| Rust/macOS | [bitflags 2.13.2](https://crates.io/crates/bitflags/2.13.2) | MIT OR Apache-2.0 | L009, L013 |
| Rust/macOS | [blake3 1.8.7](https://crates.io/crates/blake3/1.8.7) | CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception | L014, L015, L016 |
| Rust/macOS | [block2 0.6.2](https://crates.io/crates/block2/0.6.2) | MIT | L017, L018 |
| Rust/macOS | [brotli 9.0.0](https://crates.io/crates/brotli/9.0.0) | BSD-3-Clause AND MIT | L007, L019 |
| Rust/macOS | [brotli-decompressor 6.0.1](https://crates.io/crates/brotli-decompressor/6.0.1) | BSD-3-Clause/MIT | L007 |
| Rust/macOS | [bytemuck 1.25.2](https://crates.io/crates/bytemuck/1.25.2) | Zlib OR Apache-2.0 OR MIT | L020, L021, L022 |
| Rust/macOS | [byteorder-lite 0.1.0](https://crates.io/crates/byteorder-lite/0.1.0) | Unlicense OR MIT | L005, L006 |
| Rust/macOS | [bytes 1.12.1](https://crates.io/crates/bytes/1.12.1) | MIT | L023 |
| Rust/macOS | [cfb 0.14.0](https://crates.io/crates/cfb/0.14.0) | MIT | L024 |
| Rust/Wasm + Rust/macOS | [cfg-if 1.0.5](https://crates.io/crates/cfg-if/1.0.5) | MIT OR Apache-2.0 | L009, L025 |
| Rust/macOS | [constant_time_eq 0.4.2](https://crates.io/crates/constant_time_eq/0.4.2) | CC0-1.0 OR MIT-0 OR Apache-2.0 | L008, L016, L026 |
| Rust/macOS | [cookie 0.18.2](https://crates.io/crates/cookie/0.18.2) | MIT OR Apache-2.0 | L027, L028 |
| Rust/macOS | [core-foundation 0.10.1](https://crates.io/crates/core-foundation/0.10.1) | MIT OR Apache-2.0 | L009, L029 |
| Rust/macOS | [core-foundation-sys 0.8.7](https://crates.io/crates/core-foundation-sys/0.8.7) | MIT OR Apache-2.0 | L009, L029 |
| Rust/macOS | [core-graphics 0.25.0](https://crates.io/crates/core-graphics/0.25.0) | MIT OR Apache-2.0 | L030, L009, L029 |
| Rust/macOS | [core-graphics-types 0.2.0](https://crates.io/crates/core-graphics-types/0.2.0) | MIT OR Apache-2.0 | L009, L029 |
| Rust/macOS | [crc32fast 1.5.2](https://crates.io/crates/crc32fast/1.5.2) | MIT OR Apache-2.0 | L031, L032 |
| Rust/macOS | [crossbeam-channel 0.5.17](https://crates.io/crates/crossbeam-channel/0.5.17) | MIT OR Apache-2.0 | L009, L033, L034 |
| Rust/macOS | [crossbeam-utils 0.8.23](https://crates.io/crates/crossbeam-utils/0.8.23) | MIT OR Apache-2.0 | L009, L033 |
| Rust/macOS | [ctor 1.0.13](https://crates.io/crates/ctor/1.0.13) | Apache-2.0 OR MIT | L035, L036 |
| Rust/macOS | [deranged 0.5.8](https://crates.io/crates/deranged/0.5.8) | MIT OR Apache-2.0 | L037, L038 |
| Rust/macOS | [dirs 7.0.0](https://crates.io/crates/dirs/7.0.0) | MIT OR Apache-2.0 | L039, L040 |
| Rust/macOS | [dirs-sys 0.5.0](https://crates.io/crates/dirs-sys/0.5.0) | MIT OR Apache-2.0 | L039, L040 |
| Rust/macOS | [dispatch2 0.3.1](https://crates.io/crates/dispatch2/0.3.1) | Zlib OR Apache-2.0 OR MIT | L017, L018 |
| Rust/macOS | [dpi 0.1.2](https://crates.io/crates/dpi/0.1.2) | Apache-2.0 AND MIT | L041, L042 |
| Rust/macOS | [dunce 1.0.5](https://crates.io/crates/dunce/1.0.5) | CC0-1.0 OR MIT-0 OR Apache-2.0 | L016 |
| Rust/macOS | [embed_plist 1.2.2](https://crates.io/crates/embed_plist/1.2.2) | MIT OR Apache-2.0 | L043, L044 |
| Rust/macOS | [equivalent 1.0.2](https://crates.io/crates/equivalent/1.0.2) | Apache-2.0 OR MIT | L009, L045 |
| Rust/macOS | [erased-serde 0.4.10](https://crates.io/crates/erased-serde/0.4.10) | MIT OR Apache-2.0 | L008, L003 |
| Rust/macOS | [errno 0.3.14](https://crates.io/crates/errno/0.3.14) | MIT OR Apache-2.0 | L009, L046 |
| Rust/macOS | [fast_image_resize 6.1.0](https://crates.io/crates/fast_image_resize/6.1.0) | MIT OR Apache-2.0 | L047, L048 |
| Rust/macOS | [fastrand 2.5.0](https://crates.io/crates/fastrand/2.5.0) | Apache-2.0 OR MIT | L009, L003 |
| Rust/macOS | [fdeflate 0.3.7](https://crates.io/crates/fdeflate/0.3.7) | MIT OR Apache-2.0 | L049, L050 |
| Rust/macOS | [flate2 1.1.10](https://crates.io/crates/flate2/1.1.10) | MIT OR Apache-2.0 | L009, L051 |
| Rust/macOS | [fnv 1.0.7](https://crates.io/crates/fnv/1.0.7) | Apache-2.0 / MIT | L009, L052 |
| Rust/macOS | [foreign-types 0.5.0](https://crates.io/crates/foreign-types/0.5.0) | MIT/Apache-2.0 | L031, L053 |
| Rust/macOS | [foreign-types-shared 0.3.1](https://crates.io/crates/foreign-types-shared/0.3.1) | MIT/Apache-2.0 | L031, L053 |
| Rust/macOS | [form_urlencoded 1.2.2](https://crates.io/crates/form_urlencoded/1.2.2) | MIT OR Apache-2.0 | L009, L054 |
| Rust/macOS | [getrandom 0.3.4](https://crates.io/crates/getrandom/0.3.4) | MIT OR Apache-2.0 | L055, L056 |
| Rust/macOS | [getrandom 0.4.3](https://crates.io/crates/getrandom/0.4.3) | MIT OR Apache-2.0 | L055, L057 |
| Rust/macOS | [glob 0.3.4](https://crates.io/crates/glob/0.3.4) | MIT OR Apache-2.0 | L009, L013 |
| Rust/macOS | [hashbrown 0.17.1](https://crates.io/crates/hashbrown/0.17.1) | MIT OR Apache-2.0 | L009, L058 |
| Rust/macOS | [heck 0.5.0](https://crates.io/crates/heck/0.5.0) | MIT OR Apache-2.0 | L009, L059 |
| Rust/macOS | [http 1.5.0](https://crates.io/crates/http/1.5.0) | MIT OR Apache-2.0 | L060, L061 |
| Rust/macOS | [http-range 0.1.5](https://crates.io/crates/http-range/0.1.5) | MIT | L062 |
| Rust/macOS | [icu_collections 2.3.0](https://crates.io/crates/icu_collections/2.3.0) | Unicode-3.0 | L063 |
| Rust/macOS | [icu_locale_core 2.3.0](https://crates.io/crates/icu_locale_core/2.3.0) | Unicode-3.0 | L063 |
| Rust/macOS | [icu_normalizer 2.3.0](https://crates.io/crates/icu_normalizer/2.3.0) | Unicode-3.0 | L063 |
| Rust/macOS | [icu_normalizer_data 2.3.0](https://crates.io/crates/icu_normalizer_data/2.3.0) | Unicode-3.0 | L063 |
| Rust/macOS | [icu_properties 2.3.0](https://crates.io/crates/icu_properties/2.3.0) | Unicode-3.0 | L063 |
| Rust/macOS | [icu_properties_data 2.3.0](https://crates.io/crates/icu_properties_data/2.3.0) | Unicode-3.0 | L063 |
| Rust/macOS | [icu_provider 2.3.1](https://crates.io/crates/icu_provider/2.3.1) | Unicode-3.0 | L063 |
| Rust/macOS | [idna 1.1.0](https://crates.io/crates/idna/1.1.0) | MIT OR Apache-2.0 | L009, L064 |
| Rust/macOS | [idna_adapter 1.2.2](https://crates.io/crates/idna_adapter/1.2.2) | Apache-2.0 OR MIT | L009, L065 |
| Rust/macOS | [image 0.25.10](https://crates.io/crates/image/0.25.10) | MIT OR Apache-2.0 | L049, L050 |
| Rust/macOS | [indexmap 2.14.2](https://crates.io/crates/indexmap/2.14.2) | Apache-2.0 OR MIT | L009, L066 |
| Rust/macOS | [infer 0.22.0](https://crates.io/crates/infer/0.22.0) | MIT | L067 |
| Rust/Wasm + Rust/macOS | [itoa 1.0.18](https://crates.io/crates/itoa/1.0.18) | MIT OR Apache-2.0 | L008, L003 |
| Rust/macOS | [jpeg-encoder 0.7.1](https://crates.io/crates/jpeg-encoder/0.7.1) | (MIT OR Apache-2.0) AND IJG | L068, L069, L070 |
| Rust/macOS | [json-patch 4.2.0](https://crates.io/crates/json-patch/4.2.0) | MIT/Apache-2.0 | L071, L072 |
| Rust/macOS | [jsonptr 0.7.1](https://crates.io/crates/jsonptr/0.7.1) | MIT OR Apache-2.0 | L073, L074 |
| Rust/macOS | [keyboard-types 0.8.3](https://crates.io/crates/keyboard-types/0.8.3) | MIT OR Apache-2.0 | L075, L076 |
| Rust/macOS | [libc 0.2.189](https://crates.io/crates/libc/0.2.189) | MIT OR Apache-2.0 | L008, L077 |
| Rust/macOS | [litemap 0.8.3](https://crates.io/crates/litemap/0.8.3) | Unicode-3.0 | L063 |
| Rust/macOS | [log 0.4.34](https://crates.io/crates/log/0.4.34) | MIT OR Apache-2.0 | L009, L013 |
| Rust/Wasm + Rust/macOS | [memchr 2.8.3](https://crates.io/crates/memchr/2.8.3) | Unlicense OR MIT | L004, L005, L006 |
| Rust/macOS | [mime 0.3.17](https://crates.io/crates/mime/0.3.17) | MIT OR Apache-2.0 | L009, L078 |
| Rust/macOS | [miniz_oxide 0.8.9](https://crates.io/crates/miniz_oxide/0.8.9) | MIT OR Zlib OR Apache-2.0 | L079, L049, L080, L081 |
| Rust/macOS | [miniz_oxide 0.9.1](https://crates.io/crates/miniz_oxide/0.9.1) | MIT OR Zlib OR Apache-2.0 | L079, L049, L080, L081 |
| Rust/macOS | [moxcms 0.8.1](https://crates.io/crates/moxcms/0.8.1) | BSD-3-Clause OR Apache-2.0 | L082, L083 |
| Rust/macOS | [muda 0.20.0](https://crates.io/crates/muda/0.20.0) | Apache-2.0 OR MIT | L009, L084, L085 |
| Rust/macOS | [num-conv 0.2.2](https://crates.io/crates/num-conv/0.2.2) | MIT OR Apache-2.0 | L049, L086 |
| Rust/macOS | [num-traits 0.2.19](https://crates.io/crates/num-traits/0.2.19) | MIT OR Apache-2.0 | L009, L013 |
| Rust/macOS | [objc2 0.6.4](https://crates.io/crates/objc2/0.6.4) | MIT | L017, L018 |
| Rust/macOS | [objc2-app-kit 0.3.2](https://crates.io/crates/objc2-app-kit/0.3.2) | Zlib OR Apache-2.0 OR MIT | L017, L018 |
| Rust/macOS | [objc2-core-foundation 0.3.2](https://crates.io/crates/objc2-core-foundation/0.3.2) | Zlib OR Apache-2.0 OR MIT | L017, L018 |
| Rust/macOS | [objc2-core-graphics 0.3.2](https://crates.io/crates/objc2-core-graphics/0.3.2) | Zlib OR Apache-2.0 OR MIT | L017, L018 |
| Rust/macOS | [objc2-core-text 0.3.2](https://crates.io/crates/objc2-core-text/0.3.2) | Zlib OR Apache-2.0 OR MIT | L017, L018 |
| Rust/macOS | [objc2-encode 4.1.0](https://crates.io/crates/objc2-encode/4.1.0) | MIT | L017, L018 |
| Rust/macOS | [objc2-exception-helper 0.1.1](https://crates.io/crates/objc2-exception-helper/0.1.1) | Zlib OR Apache-2.0 OR MIT | L017, L018 |
| Rust/macOS | [objc2-foundation 0.3.2](https://crates.io/crates/objc2-foundation/0.3.2) | MIT | L017, L018 |
| Rust/macOS | [objc2-quartz-core 0.3.2](https://crates.io/crates/objc2-quartz-core/0.3.2) | Zlib OR Apache-2.0 OR MIT | L017, L018 |
| Rust/macOS | [objc2-web-kit 0.3.2](https://crates.io/crates/objc2-web-kit/0.3.2) | Zlib OR Apache-2.0 OR MIT | L017, L018 |
| Rust/Wasm + Rust/macOS | [once_cell 1.21.4](https://crates.io/crates/once_cell/1.21.4) | MIT OR Apache-2.0 | L009, L003 |
| Rust/macOS | [option-ext 0.2.0](https://crates.io/crates/option-ext/0.2.0) | MPL-2.0 | L087 |
| Rust/macOS | [percent-encoding 2.3.2](https://crates.io/crates/percent-encoding/2.3.2) | MIT OR Apache-2.0 | L009, L064 |
| Rust/macOS | [phf 0.13.1](https://crates.io/crates/phf/0.13.1) | MIT | L088 |
| Rust/macOS | [phf_shared 0.13.1](https://crates.io/crates/phf_shared/0.13.1) | MIT | L088 |
| Rust/macOS | [pin-project-lite 0.2.17](https://crates.io/crates/pin-project-lite/0.2.17) | Apache-2.0 OR MIT | L049, L003 |
| Rust/macOS | [plist 1.10.1](https://crates.io/crates/plist/1.10.1) | MIT | L089 |
| Rust/macOS | [png 0.18.1](https://crates.io/crates/png/0.18.1) | MIT OR Apache-2.0 | L009, L090 |
| Rust/macOS | [potential_utf 0.1.6](https://crates.io/crates/potential_utf/0.1.6) | Unicode-3.0 | L063 |
| Rust/macOS | [powerfmt 0.2.0](https://crates.io/crates/powerfmt/0.2.0) | MIT OR Apache-2.0 | L091, L092 |
| Rust/macOS | [pxfm 0.1.30](https://crates.io/crates/pxfm/0.1.30) | BSD-3-Clause OR Apache-2.0 | L082, L083 |
| Rust/macOS | [quick-xml 0.42.0](https://crates.io/crates/quick-xml/0.42.0) | MIT | L093 |
| Rust/macOS | [raw-window-handle 0.6.2](https://crates.io/crates/raw-window-handle/0.6.2) | MIT OR Apache-2.0 OR Zlib | L049, L094, L095 |
| Rust/macOS | [regex 1.13.1](https://crates.io/crates/regex/1.13.1) | MIT OR Apache-2.0 | L009, L013 |
| Rust/macOS | [regex-automata 0.4.18](https://crates.io/crates/regex-automata/0.4.18) | MIT OR Apache-2.0 | L009, L013 |
| Rust/macOS | [regex-syntax 0.8.11](https://crates.io/crates/regex-syntax/0.8.11) | MIT OR Apache-2.0 | L009, L013 |
| Rust/macOS | [rfd 0.16.0](https://crates.io/crates/rfd/0.16.0) | MIT | L096 |
| Rust/macOS | [rustix 1.1.5](https://crates.io/crates/rustix/1.1.5) | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | L097, L009, L098, L003 |
| Rust/macOS | [same-file 1.0.6](https://crates.io/crates/same-file/1.0.6) | Unlicense/MIT | L004, L099, L006 |
| Rust/macOS | [semver 1.0.28](https://crates.io/crates/semver/1.0.28) | MIT OR Apache-2.0 | L008, L003 |
| Rust/Wasm + Rust/macOS | [serde 1.0.229](https://crates.io/crates/serde/1.0.229) | MIT OR Apache-2.0 | L008, L003 |
| Rust/macOS | [serde-untagged 0.1.9](https://crates.io/crates/serde-untagged/0.1.9) | MIT OR Apache-2.0 | L008, L003 |
| Rust/Wasm + Rust/macOS | [serde_core 1.0.229](https://crates.io/crates/serde_core/1.0.229) | MIT OR Apache-2.0 | L008, L003 |
| Rust/Wasm + Rust/macOS | [serde_json 1.0.151](https://crates.io/crates/serde_json/1.0.151) | MIT OR Apache-2.0 | L008, L003 |
| Rust/macOS | [serde_spanned 1.1.1](https://crates.io/crates/serde_spanned/1.1.1) | MIT OR Apache-2.0 | L031, L100 |
| Rust/macOS | [serde_with 3.24.0](https://crates.io/crates/serde_with/3.24.0) | MIT OR Apache-2.0 | L009, L101 |
| Rust/macOS | [serialize-to-javascript 0.1.2](https://crates.io/crates/serialize-to-javascript/0.1.2) | MIT OR Apache-2.0 | L102, L103 |
| Rust/macOS | [simd-adler32 0.3.10](https://crates.io/crates/simd-adler32/0.3.10) | MIT | L104 |
| Rust/macOS | [siphasher 1.0.4](https://crates.io/crates/siphasher/1.0.4) | MIT OR Apache-2.0 | L105, L043, L106 |
| Rust/macOS | [smallvec 1.16.2](https://crates.io/crates/smallvec/1.16.2) | MIT OR Apache-2.0 | L009, L107 |
| Rust/macOS | [stable_deref_trait 1.2.1](https://crates.io/crates/stable_deref_trait/1.2.1) | MIT OR Apache-2.0 | L009, L108 |
| Rust/macOS | [tao 0.37.1](https://crates.io/crates/tao/0.37.1) | Apache-2.0 | L041, L109 |
| Rust/macOS | [tauri 2.12.0](https://crates.io/crates/tauri/2.12.0) | Apache-2.0 OR MIT | L049, L110 |
| Rust/macOS | [tauri-plugin-dialog 2.8.0](https://crates.io/crates/tauri-plugin-dialog/2.8.0) | Apache-2.0 OR MIT | L111, L112, L113 |
| Rust/macOS | [tauri-plugin-fs 2.6.0](https://crates.io/crates/tauri-plugin-fs/2.6.0) | Apache-2.0 OR MIT | L111, L112, L113 |
| Rust/macOS | [tauri-runtime 2.12.0](https://crates.io/crates/tauri-runtime/2.12.0) | Apache-2.0 OR MIT | L049, L110 |
| Rust/macOS | [tauri-runtime-wry 2.12.0](https://crates.io/crates/tauri-runtime-wry/2.12.0) | Apache-2.0 OR MIT | L049, L110 |
| Rust/macOS | [tauri-utils 2.10.0](https://crates.io/crates/tauri-utils/2.10.0) | Apache-2.0 OR MIT | L049, L110 |
| Rust/macOS | [tempfile 3.27.0](https://crates.io/crates/tempfile/3.27.0) | MIT OR Apache-2.0 | L009, L114 |
| Rust/macOS | [thiserror 2.0.21](https://crates.io/crates/thiserror/2.0.21) | MIT OR Apache-2.0 | L008, L003 |
| Rust/macOS | [time 0.3.55](https://crates.io/crates/time/0.3.55) | MIT OR Apache-2.0 | L049, L115 |
| Rust/macOS | [time-core 0.1.9](https://crates.io/crates/time-core/0.1.9) | MIT OR Apache-2.0 | L049, L115 |
| Rust/macOS | [tinystr 0.8.4](https://crates.io/crates/tinystr/0.8.4) | Unicode-3.0 | L063 |
| Rust/macOS | [tokio 1.53.1](https://crates.io/crates/tokio/1.53.1) | MIT | L116 |
| Rust/macOS | [toml 1.1.6+spec-1.1.0](https://crates.io/crates/toml/1.1.6+spec-1.1.0) | MIT OR Apache-2.0 | L031, L100 |
| Rust/macOS | [toml_datetime 1.1.1+spec-1.1.0](https://crates.io/crates/toml_datetime/1.1.1+spec-1.1.0) | MIT OR Apache-2.0 | L031, L100 |
| Rust/macOS | [toml_parser 1.1.3+spec-1.1.0](https://crates.io/crates/toml_parser/1.1.3+spec-1.1.0) | MIT OR Apache-2.0 | L031, L100 |
| Rust/macOS | [toml_writer 1.1.2+spec-1.1.0](https://crates.io/crates/toml_writer/1.1.2+spec-1.1.0) | MIT OR Apache-2.0 | L031, L100 |
| Rust/macOS | [typeid 1.0.3](https://crates.io/crates/typeid/1.0.3) | MIT OR Apache-2.0 | L008, L003 |
| Rust/Wasm | [unicode-ident 1.0.26](https://crates.io/crates/unicode-ident/1.0.26) | (MIT OR Apache-2.0) AND Unicode-3.0 | L008, L003, L117 |
| Rust/macOS | [url 2.5.8](https://crates.io/crates/url/2.5.8) | MIT OR Apache-2.0 | L009, L064 |
| Rust/macOS | [urlpattern 0.6.0](https://crates.io/crates/urlpattern/0.6.0) | MIT | L118 |
| Rust/macOS | [utf8_iter 1.0.4](https://crates.io/crates/utf8_iter/1.0.4) | Apache-2.0 OR MIT | L119, L043, L120 |
| Rust/macOS | [uuid 1.26.1](https://crates.io/crates/uuid/1.26.1) | Apache-2.0 OR MIT | L009, L121 |
| Rust/macOS | [walkdir 2.5.0](https://crates.io/crates/walkdir/2.5.0) | Unlicense/MIT | L004, L005, L006 |
| Rust/Wasm | [wasm-bindgen 0.2.129](https://crates.io/crates/wasm-bindgen/0.2.129) | MIT OR Apache-2.0 | L009, L025 |
| Rust/Wasm | [wasm-bindgen-shared 0.2.129](https://crates.io/crates/wasm-bindgen-shared/0.2.129) | MIT OR Apache-2.0 | L009, L025 |
| Rust/macOS | [web-time 1.1.0](https://crates.io/crates/web-time/1.1.0) | MIT OR Apache-2.0 | L122, L123 |
| Rust/macOS | [window-vibrancy 0.8.1](https://crates.io/crates/window-vibrancy/0.8.1) | Apache-2.0 OR MIT | L009, L124, L125 |
| Rust/macOS | [winnow 1.0.4](https://crates.io/crates/winnow/1.0.4) | MIT | L126 |
| Rust/macOS | [writeable 0.6.4](https://crates.io/crates/writeable/0.6.4) | Unicode-3.0 | L063 |
| Rust/macOS | [wry 0.57.0](https://crates.io/crates/wry/0.57.0) | Apache-2.0 OR MIT | L009, L127, L128 |
| Rust/macOS | [yoke 0.8.3](https://crates.io/crates/yoke/0.8.3) | Unicode-3.0 | L063 |
| Rust/macOS | [zerofrom 0.1.8](https://crates.io/crates/zerofrom/0.1.8) | Unicode-3.0 | L063 |
| Rust/macOS | [zerotrie 0.2.5](https://crates.io/crates/zerotrie/0.2.5) | Unicode-3.0 | L063 |
| Rust/macOS | [zerovec 0.11.8](https://crates.io/crates/zerovec/0.11.8) | Unicode-3.0 | L063 |
| Rust/Wasm + Rust/macOS | [zmij 1.0.23](https://crates.io/crates/zmij/1.0.23) | MIT | L003 |
| Rust/macOS | [zune-core 0.5.3](https://crates.io/crates/zune-core/0.5.3) | MIT OR Apache-2.0 OR Zlib | L102, L129, L130 |
| Rust/macOS | [zune-jpeg 0.5.15](https://crates.io/crates/zune-jpeg/0.5.15) | MIT OR Apache-2.0 OR Zlib | L102, L129, L130 |
| JavaScript | [@tauri-apps/api 2.12.0](https://www.npmjs.com/package/@tauri-apps/api/v/2.12.0) | Apache-2.0 OR MIT | L049, L110, L131 |
| JavaScript | [@tauri-apps/plugin-dialog 2.8.0](https://www.npmjs.com/package/@tauri-apps/plugin-dialog/v/2.8.0) | MIT OR Apache-2.0 | L111, L113, L112 |
| JavaScript | [its-fine 2.1.1](https://www.npmjs.com/package/its-fine/v/2.1.1) | MIT | L132 |
| JavaScript | [konva 10.7.0](https://www.npmjs.com/package/konva/v/10.7.0) | MIT | L133 |
| JavaScript | [lucide-react 0.468.0](https://www.npmjs.com/package/lucide-react/v/0.468.0) | ISC | L134 |
| JavaScript | [react 19.3.0](https://www.npmjs.com/package/react/v/19.3.0) | MIT | L135 |
| JavaScript | [react-dom 19.3.0](https://www.npmjs.com/package/react-dom/v/19.3.0) | MIT | L135 |
| JavaScript | [react-konva 19.3.0](https://www.npmjs.com/package/react-konva/v/19.3.0) | MIT | L136 |
| JavaScript | [react-reconciler 0.34.0](https://www.npmjs.com/package/react-reconciler/v/0.34.0) | MIT | L135 |
| JavaScript | [scheduler 0.28.0](https://www.npmjs.com/package/scheduler/v/0.28.0) | MIT | L135 |
| JavaScript | [zustand 5.0.15](https://www.npmjs.com/package/zustand/v/5.0.15) | MIT | L137 |
| Toolchain runtime | [Rust Standard Library 1.98.1](https://github.com/rust-lang/rust/tree/48a229ceaefd4985c50990b14116b6d856af0985/library) | Apache-2.0 OR MIT (see upstream notices for exceptions) | L138, L008, L139, L140, L141 |
