export const MAX_IMAGES_PER_JOB = 24;

export const STYLE_CATALOG = Object.freeze([
    Object.freeze({
        id: 'modern-minimalist', name: '现代简约', description: '清爽线条 · 中性色',
        imageUrl: './assets/ai-styles/modern-minimalist.png',
        prompt: 'modern minimalist interior, warm white and light gray, crisp simple lines, restrained furniture, subtle black accents',
    }),
    Object.freeze({
        id: 'modern-luxury', name: '现代轻奢', description: '精致材质 · 克制金属',
        imageUrl: './assets/ai-styles/modern-luxury.png',
        prompt: 'modern light luxury interior, refined stone, warm wood, restrained brushed metal accents, elegant neutral palette',
    }),
    Object.freeze({
        id: 'fresh-cream', name: '清新奶油', description: '柔和低饱和 · 温暖',
        imageUrl: './assets/ai-styles/fresh-cream.png',
        prompt: 'fresh cream interior, soft ivory and oatmeal palette, rounded furniture, boucle and pale wood, cozy and airy',
    }),
    Object.freeze({
        id: 'natural-wood', name: '原木自然', description: '温润木质 · 松弛',
        imageUrl: './assets/ai-styles/natural-wood.png',
        prompt: 'natural wood interior, warm oak grain, linen upholstery, simple handcrafted forms, calm earthy palette',
    }),
    Object.freeze({
        id: 'new-chinese', name: '新中式', description: '东方秩序 · 当代表达',
        imageUrl: './assets/ai-styles/new-chinese.png',
        prompt: 'contemporary new Chinese interior, balanced symmetry, dark timber, pale stone, restrained ink-inspired accents',
    }),
    Object.freeze({
        id: 'nordic-fresh', name: '北欧清新', description: '明亮实用 · 自然',
        imageUrl: './assets/ai-styles/nordic-fresh.png',
        prompt: 'fresh Nordic interior, bright neutral walls, pale timber, practical simple furniture, soft woven textiles',
    }),
    Object.freeze({
        id: 'japanese-wabi-sabi', name: '日式侘寂', description: '朴素留白 · 自然肌理',
        imageUrl: './assets/ai-styles/japanese-wabi-sabi.png',
        prompt: 'Japanese wabi-sabi interior, quiet minimal forms, lime plaster, aged natural wood, imperfect handmade textures',
    }),
    Object.freeze({
        id: 'french-cream', name: '法式奶油', description: '柔美线条 · 浪漫',
        imageUrl: './assets/ai-styles/french-cream.png',
        prompt: 'French cream interior, soft ivory palette, delicate wall moulding, curved furniture, understated romantic elegance',
    }),
    Object.freeze({
        id: 'italian-elegant', name: '意式典雅', description: '深色质感 · 精致',
        imageUrl: './assets/ai-styles/italian-elegant.png',
        prompt: 'elegant Italian contemporary interior, walnut, charcoal stone, refined leather and brushed metal, sophisticated restraint',
    }),
    Object.freeze({
        id: 'mid-century-vintage', name: '中古复古', description: '经典比例 · 温暖复古',
        imageUrl: './assets/ai-styles/mid-century-vintage.png',
        prompt: 'mid-century vintage interior, teak and walnut furniture, warm ochre and olive accents, classic modernist proportions',
    }),
    Object.freeze({
        id: 'american-classic', name: '美式经典', description: '沉稳舒适 · 层次',
        imageUrl: './assets/ai-styles/american-classic.png',
        prompt: 'American classic interior, comfortable generous furniture, warm wood, refined panel details, layered neutral textiles',
    }),
    Object.freeze({
        id: 'industrial', name: '工业风', description: '粗粝结构 · 都市感',
        imageUrl: './assets/ai-styles/industrial.png',
        prompt: 'refined industrial interior, dark steel, concrete and reclaimed wood, open structural details, warm focused lighting',
    }),
]);

export const ENVIRONMENT_CATALOG = Object.freeze([
    Object.freeze({
        id: 'sunny-day', name: '晴天日间', description: '明亮自然光',
        prompt: 'bright sunny daytime, soft direct daylight through windows, realistic balanced interior exposure',
    }),
    Object.freeze({
        id: 'overcast-soft', name: '阴天柔光', description: '均匀柔和光',
        prompt: 'overcast daytime, broad soft window light, gentle shadows and calm neutral ambience',
    }),
    Object.freeze({
        id: 'warm-sunset', name: '暖色黄昏', description: '夕阳与暖灯',
        prompt: 'warm sunset, low golden exterior light mixed with restrained warm interior lighting',
    }),
    Object.freeze({
        id: 'night-ambience', name: '夜间氛围', description: '层次灯光氛围',
        prompt: 'night ambience, realistic layered architectural and decorative lighting, dark exterior without losing interior detail',
    }),
]);

export const DEFAULT_GENERATION_CONDITIONS = Object.freeze({
    styleIds: Object.freeze(['modern-minimalist']),
    environmentIds: Object.freeze(['sunny-day']),
});

function normalizeIds(values, allowed) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const id = String(value ?? '').trim();
        if (!allowed.has(id) || seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }
    return result;
}

export function normalizeGenerationConditions(input = {}, {
    styles = STYLE_CATALOG,
    environments = ENVIRONMENT_CATALOG,
} = {}) {
    return {
        styleIds: normalizeIds(input.styleIds, new Set(styles.map(item => item.id))),
        environmentIds: normalizeIds(
            input.environmentIds,
            new Set(environments.map(item => item.id)),
        ),
    };
}

export function countGenerationCombinations({ viewCount, styleIds, environmentIds } = {}) {
    const views = Math.max(0, Math.floor(Number(viewCount) || 0));
    const styles = Array.isArray(styleIds) ? styleIds.length : 0;
    const environments = Array.isArray(environmentIds) ? environmentIds.length : 0;
    return views * styles * environments;
}

export function validateGenerationConditions({
    viewCount,
    styleIds,
    environmentIds,
    maxImages = MAX_IMAGES_PER_JOB,
} = {}) {
    const views = Math.max(0, Math.floor(Number(viewCount) || 0));
    const styles = Array.isArray(styleIds) ? styleIds : [];
    const environments = Array.isArray(environmentIds) ? environmentIds : [];
    const count = countGenerationCombinations({ viewCount: views, styleIds: styles, environmentIds: environments });
    if (!views) return { valid: false, count, code: 'NO_VIEWS' };
    if (!styles.length) return { valid: false, count, code: 'NO_STYLES' };
    if (!environments.length) return { valid: false, count, code: 'NO_ENVIRONMENTS' };
    if (count > Math.max(1, Math.floor(Number(maxImages) || MAX_IMAGES_PER_JOB))) {
        return { valid: false, count, code: 'TOO_MANY_IMAGES' };
    }
    return { valid: true, count, code: 'OK' };
}
