eval(file.readTextSync("lib/file.js"));
eval(safeReadTextSync("lib/region.js"));
eval(safeReadTextSync("lib/ocr.js"));


// ==============================================
// 材料CD配置与解析（通用逻辑，适配你的格式）
// ==============================================
const materialCDDir = "materialsCD"; // 材料CD目录

// 解析需要处理的CD分类（从配置读取）
const allowedCDCategories = (settings.CDCategories || "")
  .split(/[,，、 \s]+/)
  .map(cat => cat.trim())
  .filter(cat => cat !== "");

if (allowedCDCategories.length > 0) {
  log.info(`已配置只处理以下CD分类：${allowedCDCategories.join('、')}`);
} else {
  log.info(`未配置CD分类过滤，将处理所有分类`);
}
const DIR_MAX_DEPTH = Math.max(1, parseInt(settings.maxDepth || 5, 10)); // 默认5，最小1
log.info(`目录读取深度：${DIR_MAX_DEPTH}层（配置取settings.maxDepth，默认5，最小1）`);

// 输出目录最大深度处理：空值或 999 表示不限制，否则取配置值
let MAX_OUTPUT_DEPTH = 999; // 默认不限制
if (settings.maxOutputDepth !== undefined && settings.maxOutputDepth !== null && settings.maxOutputDepth !== '') {
  const parsedDepth = parseInt(settings.maxOutputDepth, 10);
  if (!isNaN(parsedDepth) && parsedDepth >= 1) {
    MAX_OUTPUT_DEPTH = parsedDepth;
  }
}
log.info(`输出目录最大深度：${MAX_OUTPUT_DEPTH === 999 ? '不限制（保留原层级）' : MAX_OUTPUT_DEPTH + '层'}（配置取 settings.maxOutputDepth，默认空值为不限制）`);


// 读取材料分类文件（通用逻辑）
function readMaterialCD(materialCDDir) {
  const materialFilePaths = readAllFilePaths(materialCDDir, 0, 1, ['.txt']);
  const materialCDCategories = {};

  for (const filePath of materialFilePaths) {
    const content = safeReadTextSync(filePath);
    if (!content) {
      log.error(`加载文件失败：${filePath}`);
      continue;
    }

    const sourceCategory = basename(filePath).replace('.txt', '');
    if (allowedCDCategories.length > 0 && !allowedCDCategories.includes(sourceCategory)) {
      log.debug(`跳过未选中的CD分类文件：${filePath}`);
      continue;
    }
    materialCDCategories[sourceCategory] = parseMaterialContent(content);
  }
  return materialCDCategories;
}

// 解析CD文件内容（适配格式：每行“分类：材料1，材料2，...”）
function parseMaterialContent(content) {
  const result = {};
  // 按行分割，过滤空行和注释
  const lines = content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  lines.forEach(line => {
    // 用中文冒号“：”分割分类名和材料列表
    const colonIndex = line.indexOf('：');
    if (colonIndex === -1) {
      log.debug(`跳过格式错误的行（无中文冒号）：${line}`);
      return;
    }

    // 提取分类名（如“46小时”）和材料部分（保留原始符号）
    const categoryKey = line.substring(0, colonIndex).trim();
    const materialsPart = line.substring(colonIndex + 1).trim();
    if (!materialsPart) {
      result[categoryKey] = { materialList: [] };
      return;
    }

    // 按中文/英文逗号分割材料名（保留原始符号，仅去空格）
    const materialList = materialsPart.split(/[,，]/)
      .map(name => name.trim()) // 只去空格，保留「」等符号
      .filter(name => name);

    result[categoryKey] = { materialList: materialList };
  });

  return result;
}

// ==============================================
// 材料名提取（保留特殊符号，优先目录匹配）
// ==============================================
function extractResourceNameFromPath(filePath, cdMaterialNames) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/');
  const validDepths = [];

  // 遍历目录，保留原始符号匹配（如「冷鲜肉」可匹配）
  for (let i = 1; i <= DIR_MAX_DEPTH && i < pathParts.length; i++) {
    const folderName = pathParts[i].trim(); // 只去空格，保留符号
    if (folderName && cdMaterialNames.has(folderName)) {
      validDepths.push({ name: folderName, depth: i });
    }
  }

  // 无匹配目录则返回null
  if (validDepths.length === 0) {
    return null;
  }

  // 多层匹配时取最外层（层级最小）
  validDepths.sort((a, b) => a.depth - b.depth);
  const bestMatch = validDepths[0];
  if (validDepths.length > 1) {
    log.debug(`材料名【${bestMatch.name}】存在多层目录匹配，选择最外层（层级${bestMatch.depth}）`);
  }
  return { name: bestMatch.name, depth: bestMatch.depth };
}

// ==============================================
// 辅助函数：生成唯一文件名（处理重复）
// ==============================================
function getUniqueFilePath(basePath) {
  if (!fileExists(basePath)) {
    return basePath;
  }
  const dir = basePath.substring(0, basePath.lastIndexOf('/') + 1);
  const fileName = basename(basePath);
  const extIndex = fileName.lastIndexOf('.');
  const nameWithoutExt = extIndex !== -1 ? fileName.substring(0, extIndex) : fileName;
  const ext = extIndex !== -1 ? fileName.substring(extIndex) : '';

  // 生成时间后缀（精确到秒，避免重复）
  const timeSuffix = new Date().toISOString()
    .replace(/[:.]/g, '')
    .slice(0, 14);

  return `${dir}${nameWithoutExt}_${timeSuffix}${ext}`;
}

// ==============================================
// 内容检测码生成（通用哈希逻辑）
// ==============================================
function generateContentCode(positions) {
  try {
    const serialized = JSON.stringify(
      positions.map(pos => ({
        type: pos.type,
        x: parseFloat(pos.x).toFixed(2),
        y: parseFloat(pos.y).toFixed(2)
      }))
    );
    let hash = 0;
    for (let i = 0; i < serialized.length; i++) {
      const char = serialized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return ((hash >>> 0).toString(16).padStart(8, '0')).slice(-8);
  } catch (error) {
    log.warn(`生成检测码失败: ${error.message}，使用默认值`);
    return "00000000";
  }
}

// ==============================================
// 主程序逻辑（通用流程）
// ==============================================
const MAX_TELEPORT_DISTANCE = 100.0;
async function main() {
  try {
    // 1. 读取并解析材料 CD，收集正式材料名（保留特殊符号）
    if (!pathExists(materialCDDir)) {
      log.error(`❌ 材料 CD 目录不存在：${materialCDDir}`);
      return;
    }
    const CDCategories = readMaterialCD(materialCDDir);
    const cdMaterialNames = new Set();

    // 收集所有选中分类下的材料名（保留原始符号，仅去空格）
    for (const [categoryName, cdInfo] of Object.entries(CDCategories)) {
      if (allowedCDCategories.length > 0 && !allowedCDCategories.includes(categoryName)) {
        log.debug(`跳过未选中的 CD 分类：${categoryName}`);
        continue;
      }
      for (const [_, materialListObj] of Object.entries(cdInfo)) {
        if (materialListObj?.materialList && Array.isArray(materialListObj.materialList)) {
          materialListObj.materialList.forEach(name => {
            cdMaterialNames.add(name.trim()); // 仅去空格，保留「」等符号
          });
        }
      }
    }

    // 验证材料名集合不为空
    if (cdMaterialNames.size === 0) {
      log.error(`❌ 未收集到任何正式材料名，程序终止`);
      return;
    }
    log.info(`✅ 共收集到${cdMaterialNames.size}个正式材料名（已过滤）`);
    log.info(`CD 文件中存在的材料名（含符号）：${Array.from(cdMaterialNames).join(', ')}`);

    // 2. 读取并解析传送点文件（使用 tranPosition）
    const tpFilePath = "assets/tp.json";
    if (!fileExists(tpFilePath)) {
      log.error(`❌ 传送点文件不存在：${tpFilePath}`);
      return;
    }

    let tpContent = safeReadTextSync(tpFilePath);
    tpContent = fixJsonFormat(tpContent); // 增强版 JSON 修复
    const topLevelData = JSON.parse(tpContent);
    const tpData = extractTeleportPoints(topLevelData);

    if (tpData.length === 0) {
      log.error(`❌ 未提取到有效传送点`);
      return;
    }
    log.info(`✅ 共提取到${tpData.length}个有效传送点`);

    // 3. 读取路径文件并处理
    const pathingDir = "pathing";
    if (!pathExists(pathingDir)) {
      log.error(`❌ 路径目录不存在：${pathingDir}`);
      return;
    }
    const pathFiles = readAllFilePaths(pathingDir, 0, DIR_MAX_DEPTH, ['.json']);
    log.info(`✅ 找到${pathFiles.length}个路径文件待处理`);

    // 用于记录每个输出目录下已处理的校验码（按目录分别去重）
    const outputDirCodesMap = new Map();
    let duplicateCount = 0;
    let successCount = 0;

    // 处理每个路径文件
    for (const pathFile of pathFiles) {
      const result = await processPathFile(pathFile, tpData, cdMaterialNames, outputDirCodesMap);
      if (result?.isDuplicate) {
        duplicateCount++;
      } else if (result?.success) {
        successCount++;
      }
    }

    log.info(`✅ 所有文件处理完成：成功 ${successCount} 个，跳过重复 ${duplicateCount} 个`);
  } catch (error) {
    log.error(`❌ 程序异常：${error.message}`);
  }
}

// 增强版JSON格式修复（处理单引号、未加引号属性名、多余逗号）
function fixJsonFormat(jsonStr) {
  return jsonStr
    .replace(/,\s*([\]}])/g, ' $1') // 末尾多余逗号处理
    .trim();
}

// 提取有效传送点（基于tranPosition）
function extractTeleportPoints(topLevelData) {
  const allPoints = [];
  if (!Array.isArray(topLevelData)) return allPoints;

  topLevelData.forEach(scene => {
    if (scene?.points && Array.isArray(scene.points)) {
      // 筛选包含tranPosition的有效传送点
      const validPoints = scene.points.map(point => ({
        ...point,
        sceneMapName: scene.mapName || "",
        sceneDescription: scene.description || "未知区域"
      })).filter(point =>
        point?.tranPosition?.length >= 3 && // 验证tranPosition存在且有效
        point.id !== undefined &&
        point.country &&
        point.area &&
        point.name
      );
      allPoints.push(...validPoints);
      log.debug(`从地图[${scene.mapName || '未知'}]提取了${validPoints.length}个传送点`);
    }
  });
  return allPoints;
}
// 处理单个路径文件（保留特殊符号匹配）
async function processPathFile(pathFile, tpData, cdMaterialNames, outputDirCodesMap) {
  try {
    const normalizedPath = pathFile.replace(/\\/g, '/');
    const fileName = basename(normalizedPath);

    // 1. 提取材料名（保留符号，优先目录，次取文件名）
    let materialInfo = extractResourceNameFromPath(normalizedPath, cdMaterialNames);

    // 目录未匹配时，从文件名提取（适配带符号的材料名，如"01-「冷鲜肉」-xxx.json"）
    if (!materialInfo) {
      const nameMatch = fileName.match(/\d+-([^-]+)-/); // 提取"「冷鲜肉」"部分
      if (nameMatch) {
        const fileNameMat = nameMatch[1].trim(); // 保留符号
        if (cdMaterialNames.has(fileNameMat)) {
          materialInfo = {name: fileNameMat, depth: -1}; // 文件名匹配，深度标记为 -1
          log.debug(`目录未匹配，从文件名提取材料名（含符号）：${materialInfo.name}`);
        }
      }
    }

    // 未匹配到材料名则跳过（记录异常）
    if (!materialInfo) {
      log.warn(`⚠️ ${fileName} 未匹配到正式材料名，跳过`);
      const errorContent = `[${new Date().toLocaleString()}] 异常路径记录：${fileName} - 未匹配到正式材料名`;
      await writeFile("异常路径记录.log", errorContent, true);
      return null;
    }

    const materialName = materialInfo.name;
    const materialDepth = materialInfo.depth;

    // 2. 读取并解析路径内容
    const pathContent = safeReadTextSync(normalizedPath);
    const pathData = JSON.parse(pathContent);

    const positions = pathData.positions || [];

    if (!Array.isArray(positions) || positions.length === 0) {
      log.warn(`⚠️ ${fileName} 无有效位置数据，跳过`);
      const errorContent = `[${new Date().toLocaleString()}] 异常路径记录：${fileName} - 无有效位置数据`;
      await writeFile("异常路径记录.log", errorContent, true);
      return null;
    }

    // 3. 生成检测码（基于坐标内容）
    const contentCode = generateContentCode(positions);

    // 4. 匹配最近的传送点（使用 tranPosition 计算）
    const teleportPos = positions.find(pos => pos.type === "teleport");
    if (!teleportPos) {
      log.warn(`⚠️ ${fileName} 无 teleport 点，跳过`);
      const errorContent = `[${new Date().toLocaleString()}] 异常路径记录：${fileName} - 无 teleport 点`;
      await writeFile("异常路径记录.log", errorContent, true);
      return null;
    }
    const targetX = parseFloat(teleportPos.x);
    const targetY = parseFloat(teleportPos.y);
    const closestTp = findClosestTeleport(tpData, targetX, targetY);

    if (!closestTp) {
      log.warn(`⚠️ ${fileName} 未找到有效传送点（距离>100），跳过`);
      const errorContent = `[${new Date().toLocaleString()}] 异常路径记录：${fileName} - 未找到有效传送点（距离>100）`;
      await writeFile("异常路径记录.log", errorContent, true);
      return null;
    }

    // 5. 构建新文件名（保留材料名原始符号）
    const newFileName = `${materialName}-${closestTp.sceneDescription}-${closestTp.country}-${closestTp.area}-${closestTp.id}-${closestTp.name}-${contentCode}.json`
        .replace(/[\\/:*?"<>|]/g, "-"); // 仅过滤系统非法字符

    // 保留到材料名所在层级的目录结构（pathing 不算层数）
    const afterPathing = normalizedPath.replace(/^pathing\//, "");
    const originalDirParts = afterPathing.split('/').filter(part => part);

    // 如果材料名来自目录匹配，保留到该层级；否则根据配置深度截断
    let keptDirs = [];
    if (materialDepth > 0) {
      // 材料名在目录中，保留到该层级（depth 已包含 pathing，需减 1）
      keptDirs = originalDirParts.slice(0, materialDepth);
    } else {
      // 材料名来自文件名，使用配置的 maxOutputDepth
      const actualDepth = Math.min(originalDirParts.length, MAX_OUTPUT_DEPTH);
      keptDirs = originalDirParts.slice(0, actualDepth);
    }

    const middleDir = keptDirs.length > 0 ? keptDirs.join('/') + '/' : '';
    const outputDir = `rename/${middleDir}`;
    const baseOutputPath = `${outputDir}${newFileName}`;
    // 6. 检查当前输出目录下是否已有相同校验码的文件
    if (!outputDirCodesMap.has(outputDir)) {
      outputDirCodesMap.set(outputDir, new Set());
    }
    const dirCodes = outputDirCodesMap.get(outputDir);

    if (dirCodes.has(contentCode)) {
      log.info(`⚠️ ${fileName} 在当前输出目录 ${outputDir} 下检测到重复内容（校验码：${contentCode}），跳过`);
      return {isDuplicate: true};
    }

    // 7. 写入文件
    // 7. 写入文件
    const writeResult = file.WriteTextSync(baseOutputPath, pathContent, false);

    if (writeResult) {
      // 记录当前目录的校验码
      dirCodes.add(contentCode);
      log.info(`✅ ${fileName} → ${basename(baseOutputPath)}`);
      return {success: true};
    } else {
      log.error(`❌ 写入文件失败：${baseOutputPath}`);
      const errorContent = `[${new Date().toLocaleString()}] 异常路径记录：${fileName} - 写入文件失败（${baseOutputPath}）`;
      await writeFile("异常路径记录.log", errorContent, true);
      return null;
    }

  } catch (error) {
    log.error(`❌ 处理${basename(pathFile)}出错：${error.message}`);
    const errorContent = `[${new Date().toLocaleString()}] 异常路径记录：${basename(pathFile)} - 处理出错（${error.message}）`;
    await writeFile("异常路径记录.log", errorContent, true);
    return null;
  }
}
// 查找最近的传送点（基于tranPosition计算距离）
function findClosestTeleport(tpData, targetX, targetY) {
  let closestTp = null;
  let minDistance = Infinity;

  tpData.forEach(tp => {
    // 关键修改：使用tranPosition获取坐标（之前误写为position）
    const tpX = parseFloat(tp.tranPosition[2]); // 对应x轴
    const tpY = parseFloat(tp.tranPosition[0]); // 对应y轴
    const distance = Math.hypot(tpX - targetX, tpY - targetY); // 直线距离

    if (distance < minDistance && distance <= MAX_TELEPORT_DISTANCE) {
      minDistance = distance;
      closestTp = { ...tp, distance };
    }
  });

  return closestTp;
}

// 执行入口（处理异步操作）
(async function () {
  setGameMetrics(1920, 1080, 1);
  await genshin.returnMainUi(); // 等待返回主界面
  await main(); // 等待主程序完成
})();
