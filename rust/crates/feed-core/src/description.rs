use rand::seq::SliceRandom;
use rand::{thread_rng, Rng};

/// Генерация описания по тем же шаблонам и вариативности, что в JS (block1And2/blocks + рандом).
pub fn generate_description(
    _title: Option<&str>,
    material_id: Option<&str>,
    _address: Option<&str>,
) -> String {
    let mat = material_id.unwrap_or_default();
    let mut rng = thread_rng();

    // разделители (6 шт.) в формате <br>_____...<br> <br>, длина 20–30, после блока2 может быть '='
    let separators = gen_separators(&mut rng);
    // порядок блоков 4-6
    let order = BLOCK_ORDER_VARIANTS
        .choose(&mut rng)
        .copied()
        .unwrap_or(BLOCK_ORDER_VARIANTS[0]);

    let (block1, block2) = match mat {
        "scheben_vtorichnyi_5_20" => (
            pick(&BLOCK_1_SHEBEN_5_20, &mut rng),
            build_block2(
                pick(&BLOCK_2_SHEBEN_INTRO_5_20, &mut rng),
                pick(&BLOCK_2_SHEBEN_5_20_HEADINGS, &mut rng),
                BLOCK_2_SHEBEN_5_20_HTML,
            ),
        ),
        "scheben_vtorichnyi_40_70" => (
            pick(&BLOCK_1_SHEBEN_40_70, &mut rng),
            build_block2(
                pick(&BLOCK_2_SHEBEN_INTRO_40_70, &mut rng),
                pick(&BLOCK_2_SHEBEN_40_70_HEADINGS, &mut rng),
                BLOCK_2_SHEBEN_40_70_HTML,
            ),
        ),
        "karier_seyan_nemyt_pesok" => (
            pick(&BLOCK_1_SEYAN_NEMYT, &mut rng),
            build_block2(
                pick(&BLOCK_2_SEYAN_NEMYT_INTRO, &mut rng),
                pick(&BLOCK_2_SEYAN_NEMYT_HEADINGS, &mut rng),
                BLOCK_2_SEYAN_NEMYT_HTML,
            ),
        ),
        "karier_seyan_myt_pesok_1.5" => (
            pick(&BLOCK_1_SEYAN_MYT_15, &mut rng),
            build_block2(
                pick(&BLOCK_2_SEYAN_MYT_FINE_INTRO, &mut rng),
                pick(&BLOCK_2_SEYAN_MYT_FINE_HEADINGS, &mut rng),
                BLOCK_2_SEYAN_MYT_FINE_HTML,
            ),
        ),
        "karier_seyan_myt_pesok_2" => (
            pick(&BLOCK_1_SEYAN_MYT_20, &mut rng),
            build_block2(
                pick(&BLOCK_2_SEYAN_MYT_MEDIUM_INTRO, &mut rng),
                pick(&BLOCK_2_SEYAN_MYT_MEDIUM_HEADINGS, &mut rng),
                BLOCK_2_SEYAN_MYT_MEDIUM_HTML,
            ),
        ),
        "karier_seyan_myt_pesok_2.5" => (
            pick(&BLOCK_1_SEYAN_MYT_25, &mut rng),
            build_block2(
                pick(&BLOCK_2_SEYAN_MYT_COARSE_INTRO, &mut rng),
                pick(&BLOCK_2_SEYAN_MYT_COARSE_HEADINGS, &mut rng),
                BLOCK_2_SEYAN_MYT_COARSE_HTML,
            ),
        ),
        _ => (
            pick(&BLOCK_1_NEMYT_NES, &mut rng),
            build_block2(
                pick(&BLOCK_2_NEMYT_NES_INTRO, &mut rng),
                pick(&BLOCK_2_NEMYT_NES_HEADINGS, &mut rng),
                BLOCK_2_NEMYT_NES_HTML,
            ),
        ),
    };

    let block3 = BLOCK_3_CALL_TO_ACTION_HTML.to_string();
    let block4 = BLOCK_4_ADVANTAGES_HTML.to_string();
    let block5 = BLOCK_5_WORK_HOURS_HTML.to_string();
    let block6 = if mat.starts_with("scheben") {
        BLOCK_6_ASSORTMENT_RUBBLE_HTML.to_string()
    } else {
        BLOCK_6_ASSORTMENT_SAND_HTML.to_string()
    };
    let block7 = build_block7(mat, &mut rng);

    let mut blocks = vec![block1, block2, block3, block4, block5, block6, block7];
    // собрать по порядку 1,2,3, затем 4-6 в выбранной перестановке, потом 7
    let mut ordered = vec![blocks[0].clone(), blocks[1].clone(), blocks[2].clone()];
    for idx in order {
        ordered.push(blocks[*idx].clone());
    }
    ordered.push(blocks[6].clone());

    // вставляем разделители между блоками (6 штук)
    let mut out = String::new();
    for (i, b) in ordered.iter().enumerate() {
        out.push_str(b);
        if i < separators.len() {
            out.push_str(&separators[i]);
        }
    }
    out
}

fn pick<'a>(arr: &'a [&'a str], rng: &mut rand::rngs::ThreadRng) -> String {
    arr.choose(rng).unwrap_or(&arr[0]).to_string()
}

fn build_block2(intro: String, heading: String, list_html: &str) -> String {
    let intro_html = if intro.is_empty() {
        "".to_string()
    } else {
        format!("<p><strong>{}</strong></p>", intro)
    };
    format!(
        "{}<p>{}</p>{}<p>Минимальный объем 20 м³ (1 самосвал)</p>",
        intro_html, heading, list_html
    )
}

fn build_block7(mat: &str, rng: &mut rand::rngs::ThreadRng) -> String {
    // Псевдо-рандомные характеристики как в JS block7Generator
    let volume = rng.gen_range(10000..100000);
    let truck_brand = pick(
        &["DAF", "Volvo", "Scania", "KAMAZ", "HOWO", "Mercedes-Benz"],
        rng,
    );
    let truck_number = rng.gen_range(100..999);
    let xpc = rand_float(rng, 0.1, 9.9, 2);
    let gp = rand_float(rng, 0.1, 2.0, 1);
    let density = rng.gen_range(1200..1700);
    let module = rand_float(rng, 1.0, 3.0, 3);
    let fraction = rand_float(rng, 1.2, 3.5, 3);
    let pnr = rand_float(rng, 0.4, 1.2, 2);
    let psi = rand_float(rng, 0.3, 2.5, 2);
    let label = match mat {
        "scheben_vtorichnyi_5_20" => "Щебень вторичный 5–20",
        "scheben_vtorichnyi_40_70" => "Щебень вторичный 40–70",
        "karier_seyan_nemyt_pesok" => "Песок карьерный сеяный немытый",
        "karier_seyan_myt_pesok_1.5" => "Песок карьерный сеяный мытый 1.0–1.5",
        "karier_seyan_myt_pesok_2" => "Песок карьерный сеяный мытый 1.5–2.0",
        "karier_seyan_myt_pesok_2.5" => "Песок карьерный сеяный мытый 2.0–2.5",
        _ => "Песок карьерный немытый",
    };
    format!(
        "<p>{}:<br> - объем: {} м³<br> - самосвал: {} гос. номер: {}<br> - содержание ХПЧ: {} %<br> - содержание ГП: {} %<br> - насыпная плотность D: {} кг/м³<br> - модуль А: {}<br> - фракция А: {}<br> - коэф ПНР: {} кг/см²<br> - коэф 𝜓: {}</p>",
        label, volume, truck_brand, truck_number, xpc, gp, density, module, fraction, pnr, psi
    )
}

fn rand_float(rng: &mut rand::rngs::ThreadRng, min: f64, max: f64, digits: usize) -> String {
    let v = rng.gen_range(min..max);
    format!("{:.*}", digits, v)
}

// разделители в формате <br>_____...<br> <br>
fn gen_separators(rng: &mut rand::rngs::ThreadRng) -> Vec<String> {
    let len = rng.gen_range(20..=30);
    let mut seps = Vec::new();
    for i in 0..6 {
        let after_block2 = i == 1;
        let line_char = if after_block2 && rng.gen_bool(0.5) {
            '='
        } else {
            '_'
        };
        let line: String = std::iter::repeat(line_char).take(len).collect();
        seps.push(format!("<br>{}<br> <br>", line));
    }
    seps
}

// порядок блоков 4-6 (индексы в массиве blocks: 3,4,5)
const BLOCK_ORDER_VARIANTS: &[&[usize]] = &[
    &[3, 4, 5],
    &[3, 5, 4],
    &[4, 3, 5],
    &[4, 5, 3],
    &[5, 3, 4],
    &[5, 4, 3],
];

const BLOCK_3_CALL_TO_ACTION_HTML: &str =
    "<p><strong>☎️ Позвоните нам - мы предложим лучшие решения и поможем с поставкой необходимых материалов для вашего проекта!</strong></p>";
const BLOCK_4_ADVANTAGES_HTML: &str = "<p>Преимущества NERUDA:<br>- Напрямую из карьера: мы получаем нерудные материалы напрямую из карьера, без посредников<br>- Собственный автопарк: самосвалы различной грузоподъемности, фронтальные погрузчики, гусеничные экскаваторы, бульдозеры<br>- Порядок с документами: оформляем вce официально и строго следим за качеством документооборота,что исключает спорные ситуации и гарантирует юридическую защиту для Заказчика<br>- Платите, как Baм удобно: наличные, карта, перевод, по счету (для юридических лиц).</p>";
const BLOCK_5_WORK_HOURS_HTML: &str =
    "<p>Режим работы:<br>- Отдел продаж консультирует Клиентов с 08:00 до 21:00</p>";
const BLOCK_6_ASSORTMENT_SAND_HTML: &str = "<p>Ассортимент товаров в наличии:<br>- Песок: карьерный, сеяный, мытый<br>- Грунт плодородный, ПРС<br>- Грунт глинистый, для отсыпки<br>- Бой бетонный, кирпичный<br>- Асфальтная крошка, отсев</p>";
const BLOCK_6_ASSORTMENT_RUBBLE_HTML: &str = "<p>Ассортимент товаров в наличии:<br>- Щебень: гравийный, гранитный, известняковый, вторичный<br>- Грунт плодородный, ПРС<br>- Грунт глинистый, для отсыпки<br>- Бой бетонный, кирпичный<br>- Асфальтная крошка, отсев</p>";

// Блок 1 варианты
const BLOCK_1_NEMYT_NES: &[&str] = &[
    "<p>Качественный карьерный песок нeмытый для подсыпки, выравнивания и планировки территорий. Подходит для траншей, оснований под плитку и благоустройства. Быстрая доставка, минимальный объем 20 м³</p>",
    "<p>Карьерный песок немытый от 20 м³. Используется для подсыпки, выравнивания и планировки. Подходит для траншей, оснований под плитку и благоустройства. Быстрая доставка</p>",
];
const BLOCK_1_SEYAN_NEMYT: &[&str] = &[
    "<p>Сеяный карьерный песок для подсыпки и оснований. Однородная фракция без крупных включений. Оптимален для подушки под плитку, тротуары, дорожки, обратной засыпки. Доставка от 20 м³</p>",
];
const BLOCK_1_SEYAN_MYT_15: &[&str] = &[
    "<p>Мытый сеяный карьерный песок. Сертифицирован, соответствует ГОСТ. Модуль крупности 1.0–1.5 (мелкий). Подходит для бетонных смесей, кладочных и штукатурных работ. Быстрая доставка, напрямую из карьера! Минимальный объем 20 м³</p>",
];
const BLOCK_1_SEYAN_MYT_20: &[&str] = &[
    "<p>Мытый сеяный карьерный песок. Сертифицирован, соответствует ГОСТ. Модуль крупности 1.5–2.0 (средний). Подходит для бетонных смесей, кладочных и штукатурных работ. Быстрая доставка, напрямую из карьера! Минимальный объем 20 м³</p>",
];
const BLOCK_1_SEYAN_MYT_25: &[&str] = &[
    "<p>Мытый сеяный карьерный песок. Сертифицирован, соответствует ГОСТ. Модуль крупности 2.0–2.5 (крупный). Подходит для бетонных смесей, кладочных и штукатурных работ. Быстрая доставка, напрямую из карьера! Минимальный объем 20 м³</p>",
];
const BLOCK_1_SHEBEN_5_20: &[&str] = &[
    "<p>Щебень вторичный фракции 5–20 мм. Используется для подсыпки, выравнивания и устройства оснований под дорожные и площадочные покрытия. Собственный автопарк, доставка от 20 м³</p>",
    "<p>Щебень вторичный фракции 5–20 мм для оснований и подсыпки. Оптимален для подготовки под бетонные и асфальтовые покрытия, дорожки, площадки. Доставка от 20 м³ по Москве и МО</p>",
];
const BLOCK_1_SHEBEN_40_70: &[&str] = &[
    "<p>Вторичный щебень фракции 40–70 мм. Применяется для отсыпки подъездных путей, площадок, укрепления слабых грунтов. Минимальный объем 20 м³</p>",
];

// Блок 2 интро/заголовки/HTML
const BLOCK_2_NEMYT_NES_INTRO: &[&str] = &[
    "Песок карьерный — природный материал из карьера без дополнительной обработки, несеяный, сохраняет разнозернистую фракцию и природные пылевые и глинистые включения.",
];
const BLOCK_2_NEMYT_NES_HEADINGS: &[&str] = &[
    "Для каких работ подходит карьерный песок немытый:",
    "Песок карьерный немытый применяется для:",
];
const BLOCK_2_NEMYT_NES_HTML: &str = "<ol> <li>Подсыпка и планировка<br> Выравнивание площадок, засыпка траншей, формирование рельефа, черновая подготовка под благоустройство.</li> <li>Подготовка оснований<br> Черновые оcнoвания под плитку, брусчатку, дорожные и технические покрытия, подушка под покрытие.</li> <li>Засыпка коммуникаций<br> Используется для подсыпки и защиты инженерных ceтeй: труб, кабелей, ливневки.</li> <li>Ландшафтные и общестроительные работы<br> Дорожки, газоны, откосы, технические слои, подсыпочные работы.</li> </ol>";

const BLOCK_2_SEYAN_NEMYT_INTRO: &[&str] = &[
    "Сеяный карьерный песок — песок из карьера после просеивания от крупных камней, без промывки, оставляет натуральные мелкие примеси.",
];
const BLOCK_2_SEYAN_NEMYT_HEADINGS: &[&str] = &[
    "Карьерный песок сеяный применяется для:",
    "Где используется сеяный карьерный песок:",
];
const BLOCK_2_SEYAN_NEMYT_HTML: &str = "<ol> <li>Подушка под брусчатку и тротуарную плитку<br> Однородная фракция без крупных включений обеспечивает ровное и стабильное основание.</li> <li>Засыпка инженерных коммуникаций<br> Контролируемое уплотнение и отсутствие мелкого мусора обеспечивают защиту труб, кабелей и ливневых систем.</li> <li>Подушка под основания для покрытий и площадок<br> Ровная подсыпка под покрытия и площадки.</li> <li>Ландшафтные работы и благоустройство<br> Дорожки, борта, откосы, подсыпка под газоны.</li> </ol>";

const BLOCK_2_SEYAN_MYT_FINE_INTRO: &[&str] = &[
    "Мытый сеяный песок 1.0–1.5 (мелкий) — карьерный песок, прошедший просеивание и промывку, с мелким зерновым составом.",
];
const BLOCK_2_SEYAN_MYT_FINE_HEADINGS: &[&str] = &[
    "Мытый сеяный песок (мелкий) применяется для:",
    "Применение сеяного мытого песка, модуль 1.0–1.5:",
];
const BLOCK_2_SEYAN_MYT_FINE_HTML: &str = "<ol> <li>Штукатурные растворы<br> Применяется в штукатурных составах.</li> <li>Кладочные растворы<br> Для цементно-песчаных кладочных растворов.</li> <li>Ремонтные и мелкозернистые растворные смеси<br> Наполнитель для мелкозернистых составов.</li> <li>Сухие строительные смеси мелкой фракции<br> Наполнитель для штукатурных/кладочных смесей.</li> </ol>";

const BLOCK_2_SEYAN_MYT_MEDIUM_INTRO: &[&str] = &[
    "Мытый сеяный песок 1.5–2.0 (средний) — карьерный песок после промывки и просеивания, со средней фракцией.",
];
const BLOCK_2_SEYAN_MYT_MEDIUM_HEADINGS: &[&str] = &[
    "Мытый сеяный песок (средний) применяется для:",
    "Применение сеяного мытого песка, модуль 1.5–2.0:",
];
const BLOCK_2_SEYAN_MYT_MEDIUM_HTML: &str = "<ol> <li>Кладочные растворы<br> Для цементно-песчаных растворов.</li> <li>Растворы общего строительного назначения<br> Универсальные смеси для монтажных и черновых работ.</li> <li>Замоноличивание и заполнение<br> Заполнение штроб, швов, пазов.</li> </ol>";

const BLOCK_2_SEYAN_MYT_COARSE_INTRO: &[&str] = &[
    "Мытый сеяный песок 2.0–2.5 (крупный) — карьерный песок, прошедший просеивание и промывку, с крупным зерновым составом.",
];
const BLOCK_2_SEYAN_MYT_COARSE_HEADINGS: &[&str] = &[
    "Мытый сеяный песок (крупный) применяется для:",
    "Применение сеяного мытого песка, модуль 2.0–2.5:",
];
const BLOCK_2_SEYAN_MYT_COARSE_HTML: &str = "<ol> <li>Бетоны повышенной прочности<br> Для конструкционных элементов и дорожных слоёв.</li> <li>Дорожные и площадочные основания<br> Несущие слои под дороги, парковки, площадки.</li> <li>Дренажные и фильтрующие слои<br> Высокая водопроницаемость.</li> <li>Подушки под основания и плиты<br> Прочный и стабильно уплотняемый слой.</li> </ol>";

const BLOCK_2_SHEBEN_INTRO_5_20: &[&str] = &[
    "Вторичный щебень 5–20 мм — щебень из дроблёного бетона и кирпича, отсортированный по мелкой фракции 5–20 мм, без крупных включений.",
];
const BLOCK_2_SHEBEN_5_20_HEADINGS: &[&str] = &[
    "Вторичный щебень 5–20 применяется для:",
    "Где используется вторичный щебень 5–20:",
];
const BLOCK_2_SHEBEN_5_20_HTML: &str = "<ol> <li>Подстилающие и выравнивающие слои<br> Подготовка основания под бетонные стяжки, плиты, тротуары, дорожки, парковочные и складские площадки.</li> <li>Засыпка траншей и котлованов<br> Обратная засыпка и выравнивание траншей.</li> <li>Основания под площадки и проезды<br> Несущие слои под подъездные пути, стоянки и технологические зоны.</li> <li>Временные и вспомогательные дорожные конструкции<br> Временные дороги и проезды для строительной техники.</li> </ol>";

const BLOCK_2_SHEBEN_INTRO_40_70: &[&str] = &[
    "Вторичный щебень 40–70 мм — щебень из дроблёного бетона и кирпича, отсортированный по крупной фракции 40–70 мм, без посторонних включений.",
];
const BLOCK_2_SHEBEN_40_70_HEADINGS: &[&str] = &[
    "Вторичный щебень 40–70 применяется для:",
    "Где используется вторичный щебень 40–70:",
];
const BLOCK_2_SHEBEN_40_70_HTML: &str = "<ol> <li>Отсыпка и поднятие уровня участка<br> Формирование насыпей и поднятие отметки участка.</li> <li>Основания под площадки и проезды<br> Несущие слои под площадки хранения, стоянки, подъездные пути.</li> <li>Засыпка котлованов и укрепление слабых грунтов<br> Заполнение котлованов, засыпка выработок.</li> <li>Временные и постоянные дороги<br> Временные и вспомогательные дороги для строительной техники.</li> </ol>";
