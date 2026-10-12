import json
import shutil

import httpx
import pytest

import pajio.personas as personas
from pajio.app import create_app
from pajio.cloud.instance import InstanceError, initialize_instance, instance_status, load_instance
from pajio.config import Settings, write_private_json
from pajio.personas import (DEFAULT_PERSONA, MAX_PROMPT_CHARS, PLATFORM_HEADING, PersonaError, available,
                            load_persona, selected_persona, soul_text)
from pajio.profile import ProfileError, digest, prepare_profile

ORIGIN = "https://pajio.example"
SECOND = {"id": "night-owl", "version": 2, "name": "小满", "summary": "夜里也醒着的猫头鹰。", "appearance": "night-owl"}


def pack(root, manifest, prompt="你叫小满，说话安静、简短。"):
    directory = root / manifest["id"]
    directory.mkdir(parents=True)
    (directory / "persona.json").write_text(json.dumps(manifest, ensure_ascii=False))
    (directory / "persona.md").write_text(prompt)
    return directory


@pytest.fixture
def packs(tmp_path, monkeypatch):
    """The shipped default pack plus a second synthetic pack."""
    root = tmp_path / "packs"
    shutil.copytree(personas.PACKS / DEFAULT_PERSONA, root / DEFAULT_PERSONA)
    pack(root, SECOND)
    monkeypatch.setattr(personas, "PACKS", root)
    return root


def upstream(tmp_path):
    source = tmp_path / "source"
    (source / "hermes_cli").mkdir(parents=True)
    (source / "hermes_cli/default_soul.py").write_text('DEFAULT_SOUL_MD = "Upstream default identity"\n')
    return source


def test_shipped_default_pack_is_valid_and_public_view_hides_the_prompt():
    bear = load_persona()
    assert bear.id == DEFAULT_PERSONA and bear.manifest.name == "Pajio"
    assert [item.id for item in available()] == [DEFAULT_PERSONA]
    assert set(bear.public()) == {"id", "version", "name", "summary", "appearance"}
    assert bear.prompt not in json.dumps(bear.public(), ensure_ascii=False)
    assert bear.receipt() == {"id": DEFAULT_PERSONA, "version": 1, "sha256": digest(bear.prompt)}


def test_soul_puts_persona_first_and_binding_platform_rules_last():
    bear = load_persona()
    soul = soul_text(bear)
    assert soul.startswith(bear.prompt)
    assert soul.index(bear.prompt) < soul.index(PLATFORM_HEADING) < soul.index("## 安全底线")
    assert "优先于上面的人格设定" in soul
    # The safety floor ships with the platform, not with any persona.
    for rule in ("不以恋人、伴侣或暧昧对象的身份", "12356", "未成年人", "不冒充真实存在的人"):
        assert rule in soul and rule not in bear.prompt


@pytest.mark.parametrize("change", [
    lambda d: (d / "persona.json").write_text(json.dumps({**SECOND, "id": "other-owl"})),
    lambda d: (d / "persona.json").write_text(json.dumps({**SECOND, "voice": "deep"})),
    lambda d: (d / "persona.json").write_text(json.dumps({**SECOND, "name": "名" * 21})),
    lambda d: (d / "persona.json").write_text("{"),
    lambda d: (d / "persona.md").write_text("  \n"),
    lambda d: (d / "persona.md").write_text("字" * (MAX_PROMPT_CHARS + 1)),
    lambda d: (d / "persona.md").write_text("你叫小满。\n\n" + PLATFORM_HEADING),
    lambda d: (d / "persona.md").unlink(),
])
def test_malformed_packs_are_rejected(tmp_path, change):
    directory = pack(tmp_path, SECOND)
    change(directory)
    with pytest.raises(PersonaError):
        load_persona("night-owl", root=tmp_path)


@pytest.mark.parametrize("persona_id", ["", "../pajama-bear", "Night-Owl", "a", "x" * 41, None])
def test_persona_ids_cannot_escape_or_be_malformed(persona_id):
    with pytest.raises(PersonaError):
        load_persona(persona_id)


def test_missing_pack_is_rejected():
    with pytest.raises(PersonaError, match="没有找到"):
        load_persona("no-such-persona")


def test_profile_writes_the_selected_persona_and_switches_owned_soul_with_backup(tmp_path, packs):
    source, home = upstream(tmp_path), tmp_path / "home"
    first = prepare_profile(home, source)
    bear_soul = (home / "SOUL.md").read_text()
    assert first["persona"]["id"] == DEFAULT_PERSONA

    owl = load_persona("night-owl")
    second = prepare_profile(home, source, persona=owl)
    soul = (home / "SOUL.md").read_text()
    assert soul.startswith("你叫小满") and "穿睡衣的小熊" not in soul
    assert PLATFORM_HEADING in soul and "## 安全底线" in soul
    assert second["persona"] == owl.receipt() and second["identity_sha256"] == digest(soul)
    assert any(path.read_text() == bear_soul for path in (home / "pajio-backups").glob("SOUL.md.*"))
    assert prepare_profile(home, source, persona=owl) == second

    (home / "SOUL.md").write_text(soul + "\n用户自定义内容\n")
    with pytest.raises(ProfileError, match="未覆盖"):
        prepare_profile(home, source)


def test_soul_written_before_persona_packs_is_recognised_as_owned(tmp_path, monkeypatch):
    from pajio import profile
    source, home = upstream(tmp_path), tmp_path / "home"
    home.mkdir()
    legacy = "你是 Pajio。旧版身份说明。"
    (home / "SOUL.md").write_text(legacy)
    with pytest.raises(ProfileError):
        prepare_profile(home, source)
    monkeypatch.setattr(profile, "LEGACY_IDENTITY_SHA256", frozenset({digest(legacy)}))
    assert prepare_profile(home, source)["persona"]["id"] == DEFAULT_PERSONA
    assert any(path.read_text() == legacy for path in (home / "pajio-backups").glob("SOUL.md.*"))


def test_local_selection_defaults_to_bear_and_reads_the_private_choice(tmp_path, packs):
    data = tmp_path / "data"
    data.mkdir()
    assert selected_persona(data, local_devices=True).id == DEFAULT_PERSONA
    write_private_json(data / "persona.json", {"id": "night-owl"})
    assert selected_persona(data, local_devices=True).id == "night-owl"
    (data / "persona.json").write_text("not json")
    with pytest.raises(PersonaError):
        selected_persona(data, local_devices=True)
    write_private_json(data / "persona.json", {"id": "no-such-persona"})
    with pytest.raises(PersonaError):
        selected_persona(data, local_devices=True)


def test_instance_fixes_its_persona_at_creation(tmp_path, packs):
    root = tmp_path / "instance"
    created = initialize_instance(root, "tenant_A", ORIGIN, "night-owl")
    assert created.persona_id == "night-owl" and instance_status(root)["persona_id"] == "night-owl"
    assert selected_persona(root / "data", local_devices=False).id == "night-owl"
    assert initialize_instance(root, "tenant_A", ORIGIN, "night-owl") == created
    with pytest.raises(InstanceError, match="人格"):
        initialize_instance(root, "tenant_A", ORIGIN)
    assert load_instance(root).persona_id == "night-owl"


def test_unknown_persona_never_creates_an_instance(tmp_path):
    root = tmp_path / "instance"
    with pytest.raises(InstanceError, match="没有找到"):
        initialize_instance(root, "tenant_A", ORIGIN, "no-such-persona")
    assert not root.exists()


def test_instance_recorded_before_persona_packs_keeps_the_default(tmp_path):
    root = tmp_path / "instance"
    initialize_instance(root, "tenant_A", ORIGIN)
    record = json.loads((root / "instance.json").read_text())
    del record["persona_id"]
    write_private_json(root / "instance.json", record)
    assert load_instance(root).persona_id == DEFAULT_PERSONA


async def test_bootstrap_exposes_the_public_persona_and_service_uses_it(tmp_path, packs):
    owl = load_persona("night-owl")
    app = create_app(Settings(tmp_path), persona=owl)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
            body = (await client.get("/api/bootstrap")).json()
        assert body["persona"] == owl.public()
        assert app.state.service.persona == owl
    finally:
        await app.state.service.hermes.close()
