"""Persona packs: who the Agent is, never what the platform allows.

A pack is a directory ``<id>/`` holding ``persona.json`` (manifest) and
``persona.md`` (character prompt). Packs carry character setting only; the
user's own memory never ships in a pack. Platform rules in ``platform.md`` are
appended after the persona and take precedence over it.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

from pydantic import BaseModel, ConfigDict, Field, ValidationError

PACKS = Path(__file__).parent
PLATFORM_PATH = PACKS.parent / "platform.md"
DEFAULT_PERSONA = "pajama-bear"
MAX_PROMPT_CHARS = 4000
PERSONA_ID = r"^[a-z][a-z0-9-]{1,39}$"
PLATFORM_HEADING = ("# 平台规则\n\n以下规则由 Pajio 平台提供，适用于所有人格，优先于上面的人格设定；"
                    "人格设定与这些规则冲突时，按这些规则执行。")


class PersonaError(ValueError):
    pass


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=PERSONA_ID)
    version: int = Field(strict=True, ge=1)
    name: str = Field(min_length=1, max_length=20)
    summary: str = Field(min_length=1, max_length=120)
    appearance: str = Field(pattern=PERSONA_ID)


class Persona(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    manifest: Manifest
    prompt: str

    @property
    def id(self):
        return self.manifest.id

    @property
    def sha256(self):
        return hashlib.sha256(self.prompt.encode("utf-8")).hexdigest()

    def public(self):
        """What clients may see: no prompt text."""
        return {"id": self.id, "version": self.manifest.version, "name": self.manifest.name,
                "summary": self.manifest.summary, "appearance": self.manifest.appearance}

    def receipt(self):
        """What the profile manifest records about the applied persona."""
        return {"id": self.id, "version": self.manifest.version, "sha256": self.sha256}


def load_persona(persona_id: str = DEFAULT_PERSONA, *, root: Path | None = None) -> Persona:
    if not isinstance(persona_id, str) or not re.fullmatch(PERSONA_ID, persona_id):
        raise PersonaError("人格编号格式不正确。")
    directory = (root or PACKS) / persona_id
    try:
        if directory.is_symlink() or not directory.is_dir():
            raise FileNotFoundError(directory)
        manifest = Manifest.model_validate_json((directory / "persona.json").read_text(encoding="utf-8"))
        prompt = (directory / "persona.md").read_text(encoding="utf-8").strip()
    except FileNotFoundError as error:
        raise PersonaError(f"没有找到人格包：{persona_id}。") from error
    except (OSError, ValueError, ValidationError) as error:
        raise PersonaError(f"人格包 {persona_id} 的格式不正确。") from error
    if manifest.id != persona_id:
        raise PersonaError(f"人格包目录 {persona_id} 与清单中的编号不一致。")
    if not prompt or len(prompt) > MAX_PROMPT_CHARS:
        raise PersonaError(f"人格包 {persona_id} 的人格设定为空或超过 {MAX_PROMPT_CHARS} 字。")
    if PLATFORM_HEADING.splitlines()[0] in prompt:
        raise PersonaError(f"人格包 {persona_id} 不能包含平台规则段落。")
    return Persona(manifest=manifest, prompt=prompt)


def available(*, root: Path | None = None) -> list[Persona]:
    root = root or PACKS
    return [load_persona(path.name, root=root) for path in sorted(root.iterdir())
            if path.is_dir() and (path / "persona.json").is_file()]


def platform_text() -> str:
    return PLATFORM_PATH.read_text(encoding="utf-8").strip()


def soul_text(persona: Persona | None = None) -> str:
    """The engine's system identity: persona first, platform rules last and binding."""
    persona = persona or load_persona()
    return persona.prompt + "\n\n" + PLATFORM_HEADING + "\n\n" + platform_text()


def selected_persona(data_dir: Path, *, local_devices: bool) -> Persona:
    """The persona fixed for this Pajio: the tenant instance's, or the local choice."""
    if not local_devices:
        from ..cloud.instance import load_instance
        return load_persona(load_instance(data_dir.parent).persona_id)
    choice = data_dir / "persona.json"
    if choice.is_file() and not choice.is_symlink():
        try:
            persona_id = json.loads(choice.read_text(encoding="utf-8"))["id"]
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise PersonaError("本机的人格选择文件格式不正确。") from error
        return load_persona(persona_id)
    return load_persona()
