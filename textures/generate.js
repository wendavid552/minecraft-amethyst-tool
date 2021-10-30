
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { ImagePool } = require('@squoosh/lib');

const [, , outputFileName, jsonFile, pngFile] = process.argv;

console.log('OUTPUT FILE', outputFileName);
console.log('JSON FILE', jsonFile);
console.log('PNG FILE', pngFile);

(async () => {
    const imagePool = new ImagePool(8);
    const contents = await promisify(fs.readFile)(pngFile);
    const image = imagePool.ingestImage(contents);
    console.log('Decoding image...');
    await image.decoded;
    console.log('Preprocessing image...');
    await image.preprocess({});
    console.log('Optimizing image...');
    await image.encode({ oxipng: {} });

    console.log('Reading optimized contents...');
    const optimizedContents = (await image.encodedWith.oxipng).binary;

    console.log('Closing image pool...');
    await imagePool.close();

    console.log('Done.');
    const url = `data:image/png;base64,${Buffer.from(optimizedContents).toString('base64')}`

    let outputFile = '// Generated by generate.js\n'
        + `export const image = "${url}";\n`;
    const jsonData = JSON.parse(await promisify(fs.readFile)(jsonFile));
    for (const tag of jsonData.meta.frameTags) {
        const { name, from } = tag;
        const frameData = jsonData.frames[from];
        outputFile += `export const ${name} = ${Math.floor(frameData.frame.x / 16)};\n`;
    }

    outputFile += `export const nImages = ${jsonData.meta.frameTags.length};\n`

    await promisify(fs.writeFile)(outputFileName, outputFile, 'utf8');
})().catch(console.error);