from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import Medication, User, UserProfile
from app.schemas import MedicationsReviewToggle, ProfileOut, ProfileUpdate
from app.routers.common import utc_now

router = APIRouter()


def _medications_signature(db: Session, user_id: int) -> str:
    rows = db.scalars(
        select(Medication)
        .where(Medication.user_id == user_id, Medication.active.is_(True))
        .order_by(Medication.id)
    ).all()
    return "|".join(
        f"{row.id}:{row.concentration_mg}:{row.concentration_volume_ml}:{row.units_per_ml}"
        for row in rows
    )


def _build_profile_out(profile: UserProfile, db: Session, user_id: int) -> ProfileOut:
    signature = _medications_signature(db, user_id)
    reviewed = bool(
        profile.medications_reviewed_at and profile.medications_reviewed_signature == signature)
    data = ProfileOut.model_validate(
        profile, from_attributes=True).model_dump()
    data["medications_reviewed"] = reviewed
    return ProfileOut(**data)


@router.get("/profile", response_model=ProfileOut)
def get_profile(user: User = Depends(current_user), db: Session = Depends(get_db)) -> ProfileOut:
    profile = db.scalar(select(UserProfile).where(
        UserProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _build_profile_out(profile, db, user.id)


@router.put("/profile", response_model=ProfileOut)
def update_profile(payload: ProfileUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> ProfileOut:
    profile = db.scalar(select(UserProfile).where(
        UserProfile.user_id == user.id))
    if profile is None:
        profile = UserProfile(user_id=user.id)
        db.add(profile)
    for field, value in payload.model_dump().items():
        setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    return _build_profile_out(profile, db, user.id)


@router.patch("/profile/medications-review", response_model=ProfileOut)
def set_medications_reviewed(payload: MedicationsReviewToggle, user: User = Depends(current_user), db: Session = Depends(get_db)) -> ProfileOut:
    profile = db.scalar(select(UserProfile).where(
        UserProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    if payload.reviewed:
        profile.medications_reviewed_at = utc_now()
        profile.medications_reviewed_signature = _medications_signature(
            db, user.id)
    else:
        profile.medications_reviewed_at = None
        profile.medications_reviewed_signature = None
    db.commit()
    db.refresh(profile)
    return _build_profile_out(profile, db, user.id)
