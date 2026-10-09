#!/bin/sh
# Instalador do Maestro para Mac (e Linux). Garante o Node e chama o setup.
# Uso: ./instalar.sh            (instala)
#      ./instalar.sh --dry-run  (so mostra o que faria)
set -e
cd "$(dirname "$0")"

# Se qualquer comando falhar, mostra em que passo parou e o que fazer, em vez de sumir calado.
PASSO="inicio"
trap 'codigo=$?; if [ $codigo -ne 0 ]; then
  echo ""
  echo "❌ A instalacao do Maestro parou no passo: $PASSO (codigo $codigo)."
  echo "   A mensagem de erro esta logo acima. Tire um print desta tela e mande para quem te passou o Maestro."
fi' EXIT

MIN_MAJOR=22
MIN_MINOR=13
NODE_LINHA="latest-v24.x"   # linha LTS instalada quando o Node falta
DRY=0
[ "$1" = "--dry-run" ] && DRY=1

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  v=$(node -p 'process.versions.node' 2>/dev/null) || return 1
  major=${v%%.*}; resto=${v#*.}; minor=${resto%%.*}
  [ "$major" -gt "$MIN_MAJOR" ] || { [ "$major" -eq "$MIN_MAJOR" ] && [ "$minor" -ge "$MIN_MINOR" ]; }
}

PASSO="verificar o Node"
if node_ok; then
  echo "Node $(node -p 'process.versions.node') ja instalado — nada a fazer."
else
  if command -v node >/dev/null 2>&1; then
    echo "Node $(node -p 'process.versions.node') e antigo (precisa $MIN_MAJOR.$MIN_MINOR+). Vou instalar a versao LTS."
  else
    echo "Node nao encontrado. Vou instalar a versao LTS."
  fi

  case "$(uname -s)" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        PASSO="instalar o Node pelo Homebrew"
        echo "-> brew install node"
        [ $DRY -eq 1 ] || brew install node
      else
        PASSO="baixar e instalar o Node do site oficial"
        BASE="https://nodejs.org/dist/$NODE_LINHA"
        LINHA=$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -E ' node-v[0-9.]+\.pkg$' | head -1)
        HASH=${LINHA%% *}
        PKG=${LINHA##* }
        [ -n "$PKG" ] || { echo "Nao consegui descobrir a versao do Node em $BASE"; exit 1; }
        echo "-> baixar $BASE/$PKG, conferir o SHA-256 e instalar (vai pedir a senha do Mac)"
        if [ $DRY -eq 0 ]; then
          TMP=$(mktemp -d)
          curl -fsSL "$BASE/$PKG" -o "$TMP/$PKG"
          echo "$HASH  $TMP/$PKG" | shasum -a 256 -c - >/dev/null || { echo "SHA-256 nao confere — instalacao cancelada."; rm -rf "$TMP"; exit 1; }
          sudo installer -pkg "$TMP/$PKG" -target /
          rm -rf "$TMP"
          PATH="/usr/local/bin:$PATH"; export PATH
        fi
      fi
      ;;
    *)
      echo "Instale o Node $MIN_MAJOR.$MIN_MINOR+ pelo gerenciador de pacotes do seu sistema e rode de novo."
      exit 1
      ;;
  esac

  if [ $DRY -eq 0 ] && ! node_ok; then
    echo "O Node foi instalado, mas este terminal ainda nao o enxerga. Abra um terminal novo e rode ./instalar.sh de novo."
    exit 1
  fi
fi

if [ $DRY -eq 1 ] && ! node_ok; then
  echo "(simulacao) depois de instalar o Node, rodaria: node scripts/setup.mjs"
  exit 0
fi
PASSO="configurar o Maestro (scripts/setup.mjs)"
node --no-warnings scripts/setup.mjs "$@"
